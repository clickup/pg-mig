/**
 * See unit test for matching and non-matching examples.
 */
export function schemaNameMatchesPrefix(
  schema: string,
  prefix: string,
): boolean {
  const schemaStartsWithPrefix = schema.startsWith(prefix);
  const schemaEqualsToPrefixExactly = schema === prefix;
  const schemaHasDigitAfterPrefix = schema
    .substring(prefix.length)
    .match(/^\d/);
  const prefixItselfHasDigitSoItIsSelectiveEnough = prefix.match(/\d/);
  return !!(
    schemaStartsWithPrefix &&
    (schemaEqualsToPrefixExactly ||
      schemaHasDigitAfterPrefix ||
      prefixItselfHasDigitSoItIsSelectiveEnough)
  );
}
