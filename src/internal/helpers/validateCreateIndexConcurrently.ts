import escapeRegExp from "lodash/escapeRegExp";
import type { Vars } from "./extractVars";
import { hasOtherSqlStatements } from "./hasOtherSqlStatements";
import { removeSqlComments } from "./removeSqlComments";

const REQUIRED_VARS = [
  "$parallelism_per_host",
  "$parallelism_global",
  "$run_alone",
] as const;

export function validateCreateIndexConcurrently(
  content: string,
  vars: Vars,
):
  | { type: "success"; indexNamesQuoted: string[] }
  | { type: "success-index-alone"; indexNamesQuoted: string[] }
  | { type: "error"; errors: string[] } {
  content = removeSqlComments(content);

  let hasCreateIndexConcurrently = false;
  const errors: string[] = [];
  const indexNamesQuoted: string[] = [];

  const regexIterator =
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+|"(?:[^"]|"")+")/gis;
  while (true) {
    const match = regexIterator.exec(content);
    if (!match) {
      break;
    }

    hasCreateIndexConcurrently = true;
    const indexNameQuoted = match[1];
    indexNamesQuoted.push(indexNameQuoted);

    const rest = content.slice(match.index + match[0].length);
    if (match.index === 0 && !hasOtherSqlStatements(rest)) {
      return REQUIRED_VARS.some((k) => !!vars[k])
        ? { type: "success-index-alone", indexNamesQuoted }
        : {
            type: "error",
            errors: [
              `start with one of the following vars: ${REQUIRED_VARS.join(", ")}`,
            ],
          };
    }

    if (
      !content.match(
        new RegExp(
          `DROP\\s+INDEX\\s+IF\\s+EXISTS\\s+${escapeRegExp(indexNameQuoted)}`,
          "is",
        ),
      )
    ) {
      errors.push(
        `include "DROP INDEX IF EXISTS ${indexNameQuoted};" statement before "CREATE INDEX CONCURRENTLY"`,
      );
    }
  }

  if (!hasCreateIndexConcurrently) {
    return { type: "success", indexNamesQuoted: [] };
  }

  if (!REQUIRED_VARS.some((k) => !!vars[k])) {
    errors.unshift(
      `start with one of the following vars: ${REQUIRED_VARS.join(", ")}`,
    );
  }

  if (!content.match(/^COMMIT\s*;/is)) {
    errors.unshift('start with "COMMIT;"');
  }

  if (!content.match(/\bBEGIN\s*;/is)) {
    errors.push(
      'end with "BEGIN;" with other optional SQL statements after it',
    );
  }

  if (errors.length > 0) {
    errors.unshift('(due to having "CREATE INDEX CONCURRENTLY")');
  }

  return errors.length > 0
    ? { type: "error", errors }
    : { type: "success", indexNamesQuoted };
}
