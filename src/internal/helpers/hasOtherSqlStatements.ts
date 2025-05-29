export function hasOtherSqlStatements(rest: string): boolean {
  return !rest.match(
    // Checks that `rest` ends with an optional ";" (possibly multiple of them),
    // but there are no other SQL statements after that.
    /^([^;]|E'([^'\\]|\\.|'')*'|'([^']|'')*'|"([^"]|"")*")*(\s*;)*$/,
  );
}
