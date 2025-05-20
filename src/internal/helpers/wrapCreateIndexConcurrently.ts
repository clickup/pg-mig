import { readFileSync } from "fs";
import { basename } from "path";
import type { Vars } from "./extractVars";
import { validateCreateIndexConcurrently } from "./validateCreateIndexConcurrently";

export function wrapCreateIndexConcurrently(
  fileName: string,
  vars: Vars,
): string[] {
  const content = readFileSync(fileName).toString();
  const res = validateCreateIndexConcurrently(content, vars);
  const include = `\\i ${basename(fileName)}`;

  if (res.type === "success-index-alone") {
    return [
      "COMMIT;",
      `DROP INDEX CONCURRENTLY IF EXISTS ${res.indexNamesQuoted[0]};`,
      include,
      "BEGIN;",
    ];
  } else {
    return [include];
  }
}
