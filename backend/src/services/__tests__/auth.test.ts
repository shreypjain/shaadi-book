import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Twilio mock
// Must be hoisted above any import that uses twilio.
// ---------------------------------------------------------------------------

const { mockVerificationsCreate, mockVerificationChecksCreate } = vi.hoisted(() => ({
  mockVerificationsCreate: vi.fn(),
  mockVerificationChecksCreate: vi.fn(),
}));

vi.mock("twilio", () => {
  const mockServicesFn = (_sid: string) => ({
    verifications: { create: mockVerificationsCreate },
    verificationChecks: { create: mockVerificationChecksCreate },
  });

  const mockClient = {
    verify: {
      v2: {
        services: mockServicesFn,
      },
    },
  };

  return { default: vi.fn(() => mockClient) };
});

// Import after mock is set up
import {
  normalizePhone,
  sendOTP,
  verifyOTP,
  generateToken,
  verifyToken,
} from "../auth.js";
import { isAdminPhone } from "../../middleware/auth.js";

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = "test-secret-at-least-32-chars-long-here";

beforeEach(() => {
  process.env["JWT_SECRET"] = TEST_JWT_SECRET;
  process.env["TWILIO_ACCOUNT_SID"] = "ACtest";
  process.env["TWILIO_AUTH_TOKEN"] = "test-token";
  process.env["TWILIO_VERIFY_SERVICE_SID"] = "VAtest";
  process.env["ADMIN_PHONE_NUMBERS"] = "+15550001111,+919876543210";
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env["JWT_SECRET"];
  delete process.env["TWILIO_ACCOUNT_SID"];
  delete process.env["TWILIO_AUTH_TOKEN"];
  delete process.env["TWILIO_VERIFY_SERVICE_SID"];
  delete process.env["ADMIN_PHONE_NUMBERS"];
});

// ---------------------------------------------------------------------------
// normalizePhone
// ---------------------------------------------------------------------------

describe("normalizePhone", () => {
  it("normalizes a 10-digit US number to E.164", () => {
    expect(normalizePhone("5551234567", "US")).toBe("+15551234567");
  });

  it("strips non-digit chars before normalizing US number", () => {
    expect(normalizePhone("(555) 123-4567", "US")).toBe("+15551234567");
  });

  it("handles US number already prefixed with 1", () => {
    expect(normalizePhone("15551234567", "US")).toBe("+15551234567");
  });

  it("normalizes a 10-digit IN number to E.164", () => {
    expect(normalizePhone("9876543210", "IN")).toBe("+919876543210");
  });

  it("strips non-digit chars before normalizing IN number", () => {
    expect(normalizePhone("+91 98765 43210", "IN")).toBe("+919876543210");
  });

  it("handles IN number already prefixed with 91", () => {
    expect(normalizePhone("919876543210", "IN")).toBe("+919876543210");
  });

  it("throws for a US number shorter than 10 digits", () => {
    expect(() => normalizePhone("12345", "US")).toThrow();
  });

  it("throws for an IN number shorter than 10 digits", () => {
    expect(() => normalizePhone("98765", "IN")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// JWT — generateToken / verifyToken
// ---------------------------------------------------------------------------

describe("generateToken", () => {
  it("returns a non-empty string", () => {
    const token = generateToken("user-123", "guest", "+15551234567");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("token has three JWT segments (header.payload.sig)", () => {
    const token = generateToken("user-123", "guest", "+15551234567");
    expect(token.split(".")).toHaveLength(3);
  });

  it("throws when JWT_SECRET is missing", () => {
    delete process.env["JWT_SECRET"];
    expect(() => generateToken("user-123", "guest", "+15551234567")).toThrow(
      "JWT_SECRET"
    );
  });
});

describe("verifyToken", () => {
  it("round-trips userId, role, phone", () => {
    const token = generateToken("user-abc", "admin", "+919876543210");
    const payload = verifyToken(token);
    expect(payload.userId).toBe("user-abc");
    expect(payload.role).toBe("admin");
    expect(payload.phone).toBe("+919876543210");
  });

  it("throws on tampered token", () => {
    const token = generateToken("user-abc", "guest", "+15551234567");
    expect(() => verifyToken(token + "tampered")).toThrow();
  });

  it("throws on token signed with a different secret", () => {
    // Sign with one secret, verify with another
    const original = process.env["JWT_SECRET"];
    process.env["JWT_SECRET"] = "secret-one-padded-to-32-characters-ok";
    const token = generateToken("user-abc", "guest", "+15551234567");

    process.env["JWT_SECRET"] = "secret-two-padded-to-32-characters-ok";
    expect(() => verifyToken(token)).toThrow();

    process.env["JWT_SECRET"] = original;
  });

  it("throws when JWT_SECRET is missing", () => {
    const token = generateToken("user-abc", "guest", "+15551234567");
    delete process.env["JWT_SECRET"];
    expect(() => verifyToken(token)).toThrow("JWT_SECRET");
  });
});

// ---------------------------------------------------------------------------
// isAdminPhone
// ---------------------------------------------------------------------------

describe("isAdminPhone", () => {
  it("returns true for a phone in ADMIN_PHONE_NUMBERS", () => {
    expect(isAdminPhone("+15550001111")).toBe(true);
    expect(isAdminPhone("+919876543210")).toBe(true);
  });

  it("returns false for a phone not in ADMIN_PHONE_NUMBERS", () => {
    expect(isAdminPhone("+15559999999")).toBe(false);
  });

  it("returns false when ADMIN_PHONE_NUMBERS is empty", () => {
    process.env["ADMIN_PHONE_NUMBERS"] = "";
    expect(isAdminPhone("+15550001111")).toBe(false);
  });

  it("handles whitespace around phone entries", () => {
    process.env["ADMIN_PHONE_NUMBERS"] = " +15550001111 , +919876543210 ";
    expect(isAdminPhone("+15550001111")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OTP — sendOTP
// ---------------------------------------------------------------------------

describe("sendOTP", () => {
  it("calls Twilio verifications.create with the phone and sms channel", async () => {
    mockVerificationsCreate.mockResolvedValueOnce({ status: "pending" });

    const result = await sendOTP("+15551234567");

    expect(mockVerificationsCreate).toHaveBeenCalledOnce();
    expect(mockVerificationsCreate).toHaveBeenCalledWith({
      to: "+15551234567",
      channel: "sms",
    });
    expect(result).toBe("pending");
  });

  it("propagates Twilio errors", async () => {
    mockVerificationsCreate.mockRejectedValueOnce(
      new Error("Twilio error: invalid phone number")
    );
    await expect(sendOTP("+15551234567")).rejects.toThrow("Twilio error");
  });

  it("throws when TWILIO_VERIFY_SERVICE_SID is missing", async () => {
    delete process.env["TWILIO_VERIFY_SERVICE_SID"];
    await expect(sendOTP("+15551234567")).rejects.toThrow(
      "TWILIO_VERIFY_SERVICE_SID"
    );
  });
});

// ---------------------------------------------------------------------------
// OTP — verifyOTP
// ---------------------------------------------------------------------------

describe("verifyOTP", () => {
  it("returns true when Twilio status is 'approved'", async () => {
    mockVerificationChecksCreate.mockResolvedValueOnce({ status: "approved" });

    const result = await verifyOTP("+15551234567", "123456");

    expect(mockVerificationChecksCreate).toHaveBeenCalledOnce();
    expect(mockVerificationChecksCreate).toHaveBeenCalledWith({
      to: "+15551234567",
      code: "123456",
    });
    expect(result).toBe(true);
  });

  it("returns false when Twilio status is 'pending' (wrong code)", async () => {
    mockVerificationChecksCreate.mockResolvedValueOnce({ status: "pending" });
    const result = await verifyOTP("+15551234567", "000000");
    expect(result).toBe(false);
  });

  it("propagates Twilio errors", async () => {
    mockVerificationChecksCreate.mockRejectedValueOnce(
      new Error("Twilio check failed")
    );
    await expect(verifyOTP("+15551234567", "123456")).rejects.toThrow(
      "Twilio check failed"
    );
  });

  it("returns false (does not throw) when Twilio returns 404 for a consumed verification", async () => {
    const err = Object.assign(new Error("Resource not found"), { status: 404 });
    mockVerificationChecksCreate.mockRejectedValueOnce(err);
    const result = await verifyOTP("+15551234567", "123456");
    expect(result).toBe(false);
  });

  it("throws when TWILIO_VERIFY_SERVICE_SID is missing", async () => {
    delete process.env["TWILIO_VERIFY_SERVICE_SID"];
    await expect(verifyOTP("+15551234567", "123456")).rejects.toThrow(
      "TWILIO_VERIFY_SERVICE_SID"
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end OTP flow (mocked Twilio)
// ---------------------------------------------------------------------------

describe("OTP flow end-to-end (mocked)", () => {
  it("full send → verify cycle returns approved status and valid JWT", async () => {
    // 1. Send OTP
    mockVerificationsCreate.mockResolvedValueOnce({ status: "pending" });
    const sendResult = await sendOTP("+15551234567");
    expect(sendResult).toBe("pending");

    // 2. Verify correct code
    mockVerificationChecksCreate.mockResolvedValueOnce({ status: "approved" });
    const approved = await verifyOTP("+15551234567", "123456");
    expect(approved).toBe(true);

    // 3. Issue and verify token
    const token = generateToken("user-999", "guest", "+15551234567");
    const payload = verifyToken(token);
    expect(payload.userId).toBe("user-999");
    expect(payload.role).toBe("guest");
    expect(payload.phone).toBe("+15551234567");
  });

  it("admin phone gets admin role in token", async () => {
    const adminPhone = "+15550001111"; // in ADMIN_PHONE_NUMBERS
    expect(isAdminPhone(adminPhone)).toBe(true);

    const token = generateToken("admin-001", "admin", adminPhone);
    const payload = verifyToken(token);
    expect(payload.role).toBe("admin");
  });

  it("non-admin phone gets guest role in token", async () => {
    const guestPhone = "+15559999999"; // not in ADMIN_PHONE_NUMBERS
    expect(isAdminPhone(guestPhone)).toBe(false);

    const token = generateToken("guest-001", "guest", guestPhone);
    const payload = verifyToken(token);
    expect(payload.role).toBe("guest");
  });
});
