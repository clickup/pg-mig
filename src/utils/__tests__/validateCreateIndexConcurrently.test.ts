import { validateCreateIndexConcurrently } from "../validateCreateIndexConcurrently";

test("validateCreateIndexConcurrently errors", () => {
  expect(
    validateCreateIndexConcurrently(
      'CREATE INDEX CONCURRENTLY "abc" ON tbl(col);',
      {}
    )
  ).toEqual([
    '(due to having "CREATE INDEX CONCURRENTLY")',
    'start with "COMMIT;"',
    "start with one of the following vars: $parallelism_per_host, $parallelism_global, $run_alone",
    'include "DROP INDEX IF EXISTS "abc";" statement before "CREATE INDEX CONCURRENTLY"',
    'end with "BEGIN;" with other optional SQL statements after it',
  ]);
});

test("validateCreateIndexConcurrently success", () => {
  expect(
    validateCreateIndexConcurrently(
      `-- $parallelism_global=1
      COMMIT;
      DROP INDEX IF EXISTS "abc""def";
      CREATE INDEX CONCURRENTLY "abc""def" ON tbl(col);',
      BEGIN;
      CREATE TABLE some(id bigint);`,
      { $parallelism_global: 1 }
    )
  ).toEqual([]);
});
