import { schemaNameMatchesPrefix } from "../schemaNameMatchesPrefix";

test("schemaNameMatchesPrefix", () => {
  expect(schemaNameMatchesPrefix("sh0001", "sh")).toBe(true);
  expect(schemaNameMatchesPrefix("sharding", "sh")).toBe(false);
  expect(schemaNameMatchesPrefix("public", "public")).toBe(true);
  expect(schemaNameMatchesPrefix("sh0001old1234", "sh")).toBe(true);
  expect(schemaNameMatchesPrefix("sh0000", "sh")).toBe(true);
  expect(schemaNameMatchesPrefix("sh0000", "sh0000")).toBe(true);
  expect(schemaNameMatchesPrefix("sh0000old1234", "sh0000")).toBe(true);
});
