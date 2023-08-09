import { extractVars } from "../extractVars";

test("extractVars", () => {
  expect(
    extractVars(
      "abc",
      "some\n--$delay = 10\nother\n-- $parallelism_global=1\ntail"
    )
  ).toEqual({ $delay: 10, $parallelism_global: 1 });
});
