import { validateCreateIndexConcurrently } from "../validateCreateIndexConcurrently";

test("no create index concurrently", () => {
  expect(
    validateCreateIndexConcurrently('CREATE INDEX "abc" ON tbl(col);', {}),
  ).toEqual({ type: "success", indexNamesQuoted: [] });
});

test("errors: multiple", () => {
  expect(
    validateCreateIndexConcurrently(
      `SELECT 1;
      CREATE INDEX CONCURRENTLY "abc" ON tbl(col);`,
      {},
    ),
  ).toEqual({
    type: "error",
    errors: [
      '(due to having "CREATE INDEX CONCURRENTLY")',
      'start with "COMMIT;"',
      "start with one of the following vars: $parallelism_per_host, $parallelism_global, $run_alone",
      'include "DROP INDEX IF EXISTS "abc";" statement before "CREATE INDEX CONCURRENTLY"',
      'end with "BEGIN;" with other optional SQL statements after it',
    ],
  });
});

test('errors: only "create index concurrently", but no vars', () => {
  expect(
    validateCreateIndexConcurrently(
      'CREATE INDEX CONCURRENTLY "abc" ON tbl(col);',
      {},
    ),
  ).toEqual({
    type: "error",
    errors: [
      "start with one of the following vars: $parallelism_per_host, $parallelism_global, $run_alone",
    ],
  });
});

test("success: regular index", () => {
  expect(
    validateCreateIndexConcurrently(
      `-- $parallelism_global=1
      COMMIT;
      DROP INDEX IF EXISTS "abc""def";
      CREATE INDEX CONCURRENTLY "abc""def" ON tbl(col);',
      BEGIN;
      CREATE TABLE some(id bigint);`,
      { $parallelism_global: 1 },
    ),
  ).toEqual({ type: "success", indexNamesQuoted: ['"abc""def"'] });
});

test("success: unique index", () => {
  expect(
    validateCreateIndexConcurrently(
      `-- $parallelism_global=1
      COMMIT;
      DROP INDEX IF EXISTS "abc""def";
      CREATE uNiQuE   INDEX  CONCURRENTLY  "abc""def" ON tbl(col);',
      BEGIN;
      CREATE TABLE some(id bigint);`,
      { $parallelism_global: 1 },
    ),
  ).toEqual({ type: "success", indexNamesQuoted: ['"abc""def"'] });
});

test("success: if not exists", () => {
  expect(
    validateCreateIndexConcurrently(
      `-- $parallelism_per_host=1
      COMMIT;
      DROP INDEX IF EXISTS "abc""def";
      CREATE INDEX CONCURRENTLY IF NOT EXISTS  "abc""def" ON tbl(col);',
      BEGIN;
      CREATE TABLE some(id bigint);`,
      { $parallelism_global: 1 },
    ),
  ).toEqual({ type: "success", indexNamesQuoted: ['"abc""def"'] });
});

test('success: only "create index concurrently", with comments', () => {
  expect(
    validateCreateIndexConcurrently(
      `-- Some comment.
      /* Some other
      comment. */
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "abc""def" ON tbl(col);`,
      { $parallelism_per_host: 1 },
    ),
  ).toEqual({ type: "success-index-alone", indexNamesQuoted: ['"abc""def"'] });
});

test('success: only "create index concurrently", with semicolon in literal', () => {
  expect(
    validateCreateIndexConcurrently(
      String.raw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "abc""def" ON tbl(col) WHERE col='a;b';`,
      { $parallelism_per_host: 2 },
    ),
  ).toEqual({ type: "success-index-alone", indexNamesQuoted: ['"abc""def"'] });
});

test('success: only "create index concurrently", with semicolon in identifier', () => {
  expect(
    validateCreateIndexConcurrently(
      String.raw`; ; CREATE INDEX CONCURRENTLY IF NOT EXISTS "abc""def" ON tbl(col) WHERE "a;b"=42;;;`,
      { $parallelism_per_host: 2 },
    ),
  ).toEqual({ type: "success-index-alone", indexNamesQuoted: ['"abc""def"'] });
});
