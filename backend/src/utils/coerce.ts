/**
 * Shared coercion utilities for normalising Prisma / Postgres numeric returns.
 *
 * Postgres returns NUMERIC/DECIMAL columns as strings, BigInt columns as
 * bigint, and raw SQL aggregates as either bigint or string depending on the
 * driver.  Prisma wraps DECIMALs in a Decimal.js object that has a toNumber()
 * method.  This helper normalises all these variants into a plain JS number.
 */

/** Coerce any Postgres/Prisma numeric return to a plain JS number. */
export function toNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "string") return parseFloat(val) || 0;
  // Decimal objects from decimal.js / @prisma/client
  if (typeof val === "object" && "toNumber" in val) {
    return (val as { toNumber(): number }).toNumber();
  }
  return parseFloat(String(val)) || 0;
}
