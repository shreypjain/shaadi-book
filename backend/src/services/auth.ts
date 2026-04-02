import twilio from "twilio";
import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// Phone normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a phone number to E.164 format.
 * Strips non-digit characters, then prepends the country prefix.
 * - US: +1XXXXXXXXXX (10-digit local number)
 * - IN: +91XXXXXXXXXX (10-digit local number)
 */
export function normalizePhone(phone: string, country: "US" | "IN"): string {
  const digits = phone.replace(/\D/g, "");
  if (country === "US") {
    // Take the last 10 digits (handles numbers like 15551234567 or 5551234567)
    const local = digits.slice(-10);
    if (local.length !== 10) {
      throw new Error(`Invalid US phone number: ${phone}`);
    }
    return `+1${local}`;
  } else {
    // IN: take last 10 digits
    const local = digits.slice(-10);
    if (local.length !== 10) {
      throw new Error(`Invalid IN phone number: ${phone}`);
    }
    return `+91${local}`;
  }
}

// ---------------------------------------------------------------------------
// Twilio client factory — injectable for tests
// ---------------------------------------------------------------------------

export function createTwilioClient(): ReturnType<typeof twilio> {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
  }
  return twilio(accountSid, authToken);
}

// ---------------------------------------------------------------------------
// OTP — send via Twilio Verify
// ---------------------------------------------------------------------------

/**
 * Send an OTP to the given E.164 phone number via Twilio Verify.
 *
 * We use Verify (not Messages API) because US carriers block A2P SMS from
 * unregistered local numbers (error 30034). Verify uses Twilio's
 * pre-approved short codes that bypass carrier filtering.
 *
 * Cost: $0.05/verification.
 */
export async function sendOTP(phone: string): Promise<"pending"> {
  const serviceSid = process.env["TWILIO_VERIFY_SERVICE_SID"];
  if (!serviceSid) {
    throw new Error("TWILIO_VERIFY_SERVICE_SID must be set");
  }
  const client = createTwilioClient();
  const verification = await client.verify.v2
    .services(serviceSid)
    .verifications.create({ to: phone, channel: "sms" });
  console.log(`[auth] OTP sent via Twilio Verify to ${phone}`);
  return verification.status as "pending";
}

// ---------------------------------------------------------------------------
// OTP — verify
// ---------------------------------------------------------------------------

/**
 * Check an OTP code against Twilio Verify.
 * Returns true if the code is 'approved', false otherwise.
 */
export async function verifyOTP(
  phone: string,
  code: string
): Promise<boolean> {
  const serviceSid = process.env["TWILIO_VERIFY_SERVICE_SID"];
  if (!serviceSid) {
    throw new Error("TWILIO_VERIFY_SERVICE_SID must be set");
  }
  const client = createTwilioClient();
  const check = await client.verify.v2
    .services(serviceSid)
    .verificationChecks.create({ to: phone, code });
  const approved = check.status === "approved";
  console.log(`[auth] OTP verify for ${phone}: ${approved ? "approved" : "rejected"}`);
  return approved;
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

export interface TokenPayload {
  userId: string;
  role: string;
  phone: string;
}

/**
 * Issue a signed JWT with 24h expiry.
 * Payload: { userId, role, phone }
 */
export function generateToken(
  userId: string,
  role: string,
  phone: string
): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    throw new Error("JWT_SECRET must be set");
  }
  return jwt.sign({ userId, role, phone }, secret, { expiresIn: "24h" });
}

/**
 * Verify and decode a JWT.
 * Throws if the token is invalid or expired.
 */
export function verifyToken(token: string): TokenPayload {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    throw new Error("JWT_SECRET must be set");
  }
  const decoded = jwt.verify(token, secret);
  if (
    typeof decoded === "object" &&
    decoded !== null &&
    "userId" in decoded &&
    "role" in decoded &&
    "phone" in decoded
  ) {
    return decoded as TokenPayload;
  }
  throw new Error("Invalid token payload");
}
