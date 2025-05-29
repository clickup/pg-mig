import { validateDropIndexConcurrently } from "../validateDropIndexConcurrently";

test("errors: multiple statements", () => {
  expect(
    validateDropIndexConcurrently(
      `SELECT 1;
      DROP INDEX CONCURRENTLY "abc"`,
    ),
  ).toEqual({
    type: "error",
    errors: [
      '(due to having "DROP INDEX CONCURRENTLY")',
      'start with "COMMIT;"',
      'end with "BEGIN;" with other optional SQL statements after it',
    ],
  });

  expect(
    validateDropIndexConcurrently(
      `SELECT 1;
      DROP INDEX CONCURRENTLY "abc";; ;`,
    ),
  ).toEqual({
    type: "error",
    errors: [
      '(due to having "DROP INDEX CONCURRENTLY")',
      'start with "COMMIT;"',
      'end with "BEGIN;" with other optional SQL statements after it',
    ],
  });
});

test("errors: no IF EXISTS", () => {
  expect(
    validateDropIndexConcurrently('DROP INDEX CONCURRENTLY "abc"'),
  ).toEqual({
    type: "error",
    errors: [
      "DROP INDEX CONCURRENTLY is alone in the file, so it must use IF EXISTS",
    ],
  });
});

test("success: no drop index concurrently", () => {
  expect(validateDropIndexConcurrently('DROP INDEX "abc";')).toEqual({
    type: "success",
  });
});

test("success: in transaction", () => {
  expect(
    validateDropIndexConcurrently(
      `COMMIT;
      DROP INDEX CONCURRENTLY "abc""def";
      BEGIN;
      CREATE TABLE some(id bigint);`,
    ),
  ).toEqual({ type: "success" });
});

test("success: if exists in transaction", () => {
  expect(
    validateDropIndexConcurrently(
      `COMMIT;
      DROP INDEX CONCURRENTLY IF EXISTS "abc""def";
      BEGIN;
      CREATE TABLE some(id bigint);`,
    ),
  ).toEqual({ type: "success" });
});

test('success: only "drop index concurrently", with comments', () => {
  expect(
    validateDropIndexConcurrently(
      `-- Some comment.
      /* Some other
      comment. */
      DROP INDEX CONCURRENTLY IF EXISTS "abc""def";`,
    ),
  ).toEqual({ type: "success-index-alone" });
});

test('success: only "drop index concurrently", with semicolon in identifier', () => {
  expect(
    validateDropIndexConcurrently(
      String.raw`DROP INDEX CONCURRENTLY IF EXISTS "ab;c""def";`,
    ),
  ).toEqual({ type: "success-index-alone" });
});
