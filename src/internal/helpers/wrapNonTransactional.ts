import { readFileSync } from "fs";
import { basename } from "path";
import type { Vars } from "./extractVars";
import { validateCreateIndexConcurrently } from "./validateCreateIndexConcurrently";
import { validateDropIndexConcurrently } from "./validateDropIndexConcurrently";

export function wrapNonTransactional(
  fileName: string,
  vars: Vars,
): {
  lines: string[];
  errors: string[];
} {
  const content = readFileSync(fileName).toString();
  const include = `\\i ${basename(fileName)}`;

  const resCreate = validateCreateIndexConcurrently(content, vars);
  if (resCreate.type === "success-index-alone") {
    return {
      lines: [
        "COMMIT;",
        `DROP INDEX CONCURRENTLY IF EXISTS ${resCreate.indexNamesQuoted[0]};`,
        include,
        "BEGIN;",
      ],
      errors: [],
    };
  } else if (resCreate.type === "error") {
    return {
      lines: [],
      errors: resCreate.errors,
    };
  }

  const resDrop = validateDropIndexConcurrently(content);
  if (resDrop.type === "success-index-alone") {
    return {
      lines: ["COMMIT;", include, "BEGIN;"],
      errors: [],
    };
  } else if (resDrop.type === "error") {
    return {
      lines: [],
      errors: resDrop.errors,
    };
  }

  return {
    lines: [include],
    errors: [],
  };
}
