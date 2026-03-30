/**
 * Global test setup — runs before every test file.
 *
 * When TEST_DATABASE_URL is explicitly set, it is copied to DATABASE_URL so
 * integration tests use the dedicated test database instead of the dev database.
 *
 * When neither TEST_DATABASE_URL nor DATABASE_URL is set (e.g. in CI with no
 * database service), DATABASE_URL remains unset and the describe.skipIf guards
 * in each DB-dependent test file will skip those tests automatically.
 *
 * To run DB tests locally: set TEST_DATABASE_URL in your shell or .env.test
 * (e.g. TEST_DATABASE_URL=postgresql://shaadi:shaadi123@localhost:5432/shaadi_book_test).
 */

// Must be set before PrismaClient is instantiated anywhere.
if (process.env["TEST_DATABASE_URL"]) {
  process.env["DATABASE_URL"] = process.env["TEST_DATABASE_URL"];
}
