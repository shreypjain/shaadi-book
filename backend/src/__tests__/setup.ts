/**
 * Global test setup — runs before every test file.
 *
 * Sets DATABASE_URL to the dedicated test database so integration tests never
 * touch the development database.
 */

// Must be set before PrismaClient is instantiated anywhere.
process.env["DATABASE_URL"] =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://shaadi:shaadi123@localhost:5432/shaadi_book_test";
