/**
 * SMS Commands Tests — Task 5.1
 *
 * Coverage paths:
 *   parseCommand:
 *     1. NEW command parsed correctly (question + outcome labels extracted)
 *     2. RESOLVE command parsed correctly (marketRef + winningOutcome extracted)
 *     3. PAUSE command parsed correctly
 *     4. STATUS command parsed correctly
 *     5. Missing pipe segments → UNKNOWN
 *     6. NEW with only one outcome → UNKNOWN
 *     7. Completely unrecognised text → UNKNOWN
 *
 *   executeCommand:
 *     8. Non-admin phone rejected (returns error string, no DB hit)
 *     9. Unknown command format returns usage hint (admin phone, no DB hit)
 *
 *   formatMarketStatus:
 *     10. Returns correctly formatted string with leading outcome
 *     11. Handles empty outcomes gracefully
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock db.js before any module that imports it
// (PrismaClient is a side-effect-free singleton — mocking avoids the real
//  connection being attempted during unit tests that never call the DB.)
// ---------------------------------------------------------------------------

vi.mock("../../db.js", () => ({
  prisma: {},
}));

// Import the module under test after mocks are set up
import {
  parseCommand,
  executeCommand,
  formatMarketStatus,
} from "../smsCommands.js";
import type { MarketWithPrices } from "../marketService.js";

// ---------------------------------------------------------------------------
// Environment setup — admin phone list
// ---------------------------------------------------------------------------

const ADMIN_PHONE = "+15550001111";
const GUEST_PHONE = "+15559999999";

beforeEach(() => {
  process.env["ADMIN_PHONE_NUMBERS"] = ADMIN_PHONE;
});

afterEach(() => {
  delete process.env["ADMIN_PHONE_NUMBERS"];
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// parseCommand — NEW
// ---------------------------------------------------------------------------

describe("parseCommand — NEW", () => {
  it("parses a well-formed NEW command", () => {
    const result = parseCommand("NEW | Will dad dance? | Yes, No");
    expect(result.type).toBe("NEW");
    if (result.type === "NEW") {
      expect(result.question).toBe("Will dad dance?");
      expect(result.outcomes).toEqual(["Yes", "No"]);
    }
  });

  it("handles extra whitespace around pipes and commas", () => {
    const result = parseCommand("NEW  |  Question here?  |  A ,  B ,  C");
    expect(result.type).toBe("NEW");
    if (result.type === "NEW") {
      expect(result.question).toBe("Question here?");
      expect(result.outcomes).toEqual(["A", "B", "C"]);
    }
  });

  it("parses 5 outcomes (max allowed)", () => {
    const result = parseCommand("NEW | Q? | A, B, C, D, E");
    expect(result.type).toBe("NEW");
    if (result.type === "NEW") {
      expect(result.outcomes).toHaveLength(5);
    }
  });

  it("returns UNKNOWN when fewer than 2 outcomes are provided", () => {
    const result = parseCommand("NEW | Question? | OnlyOne");
    expect(result.type).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when outcomes segment is missing", () => {
    const result = parseCommand("NEW | Question only");
    expect(result.type).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when question is empty", () => {
    const result = parseCommand("NEW |  | Yes, No");
    expect(result.type).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// parseCommand — RESOLVE
// ---------------------------------------------------------------------------

describe("parseCommand — RESOLVE", () => {
  it("parses a RESOLVE command with numeric market ref", () => {
    const result = parseCommand("RESOLVE | 7 | Yes");
    expect(result.type).toBe("RESOLVE");
    if (result.type === "RESOLVE") {
      expect(result.marketRef).toBe("7");
      expect(result.winningOutcome).toBe("Yes");
    }
  });

  it("parses a RESOLVE command with UUID market ref", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const result = parseCommand(`RESOLVE | ${uuid} | Outcome A`);
    expect(result.type).toBe("RESOLVE");
    if (result.type === "RESOLVE") {
      expect(result.marketRef).toBe(uuid);
      expect(result.winningOutcome).toBe("Outcome A");
    }
  });

  it("returns UNKNOWN when winning outcome is missing", () => {
    const result = parseCommand("RESOLVE | 7");
    expect(result.type).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when market ref is missing", () => {
    const result = parseCommand("RESOLVE");
    expect(result.type).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// parseCommand — PAUSE
// ---------------------------------------------------------------------------

describe("parseCommand — PAUSE", () => {
  it("parses a PAUSE command", () => {
    const result = parseCommand("PAUSE | 3");
    expect(result.type).toBe("PAUSE");
    if (result.type === "PAUSE") {
      expect(result.marketRef).toBe("3");
    }
  });

  it("returns UNKNOWN when market ref is missing", () => {
    const result = parseCommand("PAUSE");
    expect(result.type).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// parseCommand — STATUS
// ---------------------------------------------------------------------------

describe("parseCommand — STATUS", () => {
  it("parses a STATUS command", () => {
    const result = parseCommand("STATUS | 5");
    expect(result.type).toBe("STATUS");
    if (result.type === "STATUS") {
      expect(result.marketRef).toBe("5");
    }
  });
});

// ---------------------------------------------------------------------------
// parseCommand — unknown / invalid formats
// ---------------------------------------------------------------------------

describe("parseCommand — invalid / unknown formats", () => {
  it("returns UNKNOWN for completely unrecognised text", () => {
    const result = parseCommand("GARBAGE COMMAND HERE");
    expect(result.type).toBe("UNKNOWN");
    if (result.type === "UNKNOWN") {
      expect(result.raw).toBe("GARBAGE COMMAND HERE");
    }
  });

  it("returns UNKNOWN for empty string", () => {
    expect(parseCommand("").type).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for lone pipe", () => {
    expect(parseCommand("|").type).toBe("UNKNOWN");
  });

  it("is case-insensitive for the command keyword", () => {
    // 'new' should parse the same as 'NEW'
    const result = parseCommand("new | My question? | Yes, No");
    expect(result.type).toBe("NEW");
  });
});

// ---------------------------------------------------------------------------
// executeCommand — non-admin phone rejected
// ---------------------------------------------------------------------------

describe("executeCommand — authorization", () => {
  it("rejects a non-admin phone number without touching the DB", async () => {
    const reply = await executeCommand(GUEST_PHONE, "STATUS | 1");
    expect(reply).toContain("Unauthorized");
  });

  it("returns the same rejection regardless of command content", async () => {
    const replyNew = await executeCommand(
      GUEST_PHONE,
      "NEW | Question? | Yes, No"
    );
    const replyResolve = await executeCommand(
      GUEST_PHONE,
      "RESOLVE | 1 | Yes"
    );
    expect(replyNew).toContain("Unauthorized");
    expect(replyResolve).toContain("Unauthorized");
  });

  it("does not reject a valid admin phone", async () => {
    // Admin phone passes auth; will fail at DB lookup (user not found) —
    // but the response must NOT contain "Unauthorized".
    const reply = await executeCommand(
      ADMIN_PHONE,
      "GARBAGE INPUT",
      { prismaClient: undefined as never }
    );
    expect(reply).not.toContain("Unauthorized");
  });
});

// ---------------------------------------------------------------------------
// executeCommand — unknown command format
// ---------------------------------------------------------------------------

describe("executeCommand — unknown command format", () => {
  it("returns a usage hint for an admin with an unrecognised command", async () => {
    // UNKNOWN command is rejected before any DB access, so no prismaClient needed
    const reply = await executeCommand(ADMIN_PHONE, "HELLO THERE");
    expect(reply).toContain("Unknown command format");
    expect(reply).toContain("NEW");
    expect(reply).toContain("RESOLVE");
  });

  it("returns usage hint for a NEW command with too few outcomes", async () => {
    const reply = await executeCommand(
      ADMIN_PHONE,
      "NEW | Question? | OnlyOneOutcome"
    );
    expect(reply).toContain("Unknown command format");
  });
});

// ---------------------------------------------------------------------------
// formatMarketStatus
// ---------------------------------------------------------------------------

describe("formatMarketStatus", () => {
  const makeMarket = (
    outcomes: Array<{ label: string; price: number }>
  ): MarketWithPrices => ({
    id: "test-id",
    question: "Test?",
    status: "ACTIVE",
    openedAt: new Date(),
    scheduledOpenAt: null,
    bFloorOverride: null,
    createdAt: new Date(),
    resolvedAt: null,
    winningOutcomeId: null,
    outcomes: outcomes.map((o, i) => ({
      id: `o${i}`,
      label: o.label,
      position: i,
      sharesSold: 0,
      isWinner: null,
      price: o.price,
      priceCents: Math.round(o.price * 100),
    })),
    currentB: 20,
    totalVolume: 50,
  });

  it("formats a binary market with the leading outcome highlighted", () => {
    const market = makeMarket([
      { label: "Yes", price: 0.62 },
      { label: "No", price: 0.38 },
    ]);
    const result = formatMarketStatus(market, 7, 45);
    expect(result).toBe("Market #7: 45 trades, midpoint Yes=$0.62");
  });

  it("picks the highest-probability outcome as midpoint", () => {
    const market = makeMarket([
      { label: "A", price: 0.1 },
      { label: "B", price: 0.7 },
      { label: "C", price: 0.2 },
    ]);
    const result = formatMarketStatus(market, 3, 10);
    expect(result).toContain("midpoint B=$0.70");
  });

  it("handles zero trades gracefully", () => {
    const market = makeMarket([
      { label: "Yes", price: 0.5 },
      { label: "No", price: 0.5 },
    ]);
    const result = formatMarketStatus(market, 1, 0);
    expect(result).toContain("0 trades");
  });

  it("handles empty outcomes array", () => {
    const market = makeMarket([]);
    const result = formatMarketStatus(market, 2, 5);
    expect(result).toContain("Market #2");
    expect(result).toContain("5 trades");
  });
});
