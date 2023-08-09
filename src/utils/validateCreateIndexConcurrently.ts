import escapeRegExp from "lodash/escapeRegExp";
import type { Vars } from "./extractVars";

export function validateCreateIndexConcurrently(
  content: string,
  vars: Vars
): string[] {
  content = content
    .replace(/--[^\n]*/gm, "")
    .replace(/\/\*.*?\*\//gs, "")
    .replace(/ (UNIQUE|IF NOT EXISTS) /gis, " ")
    .replace(/\s+/gs, " ")
    .trim();

  let hasCreateIndexConcurrently = false;
  const errors: string[] = [];

  const regexIterator = /CREATE INDEX CONCURRENTLY (\S+|"(?:[^"]|"")+")/gis;
  while (regexIterator.exec(content)) {
    hasCreateIndexConcurrently = true;
    const index = RegExp.$1;
    if (
      !content.match(
        new RegExp(`DROP INDEX IF EXISTS ${escapeRegExp(index)}`, "is")
      )
    ) {
      errors.push(
        `include "DROP INDEX IF EXISTS ${index};" statement before "CREATE INDEX CONCURRENTLY"`
      );
    }
  }

  if (hasCreateIndexConcurrently) {
    const requiredVars = [
      "$parallelism_per_host",
      "$parallelism_global",
      "$run_alone",
    ] as const;
    if (!requiredVars.some((k) => !!vars[k])) {
      errors.unshift(
        "start with one of the following vars: " + requiredVars.join(", ")
      );
    }

    if (!content.match(/^COMMIT\s*;/is)) {
      errors.unshift('start with "COMMIT;"');
    }

    if (!content.match(/\bBEGIN\s*;/is)) {
      errors.push(
        'end with "BEGIN;" with other optional SQL statements after it'
      );
    }
  }

  if (errors.length > 0) {
    errors.unshift('(due to having "CREATE INDEX CONCURRENTLY")');
  }

  return errors;
}
