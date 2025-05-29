export function removeSqlComments(content: string): string {
  return content
    .replace(/--[^\n]*/gm, "")
    .replace(/\/\*.*?\*\//gs, "")
    .replace(/^(\s*;)+/gs, "")
    .trim();
}
