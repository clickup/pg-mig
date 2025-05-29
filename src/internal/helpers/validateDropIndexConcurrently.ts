import { hasOtherSqlStatements } from "./hasOtherSqlStatements";
import { removeSqlComments } from "./removeSqlComments";

export function validateDropIndexConcurrently(
  content: string,
):
  | { type: "success" }
  | { type: "success-index-alone" }
  | { type: "error"; errors: string[] } {
  content = removeSqlComments(content);

  let hasDropIndexConcurrently = false;
  const errors: string[] = [];

  const regexIterator =
    /\DROP\s+INDEX\s+CONCURRENTLY\s+(IF\s+EXISTS\s+)?([^;"]+|"(?:[^"]|"")+")+/gis;
  while (true) {
    const match = regexIterator.exec(content);
    if (!match) {
      break;
    }

    hasDropIndexConcurrently = true;
    const rest = content.slice(match.index + match[0].length);
    if (match.index === 0 && !hasOtherSqlStatements(rest)) {
      return match[1]
        ? { type: "success-index-alone" }
        : {
            type: "error",
            errors: [
              "DROP INDEX CONCURRENTLY is alone in the file, so it must use IF EXISTS",
            ],
          };
    }
  }

  if (!hasDropIndexConcurrently) {
    return { type: "success" };
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
    errors.unshift('(due to having "DROP INDEX CONCURRENTLY")');
  }

  return errors.length > 0 ? { type: "error", errors } : { type: "success" };
}
