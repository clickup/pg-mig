import { Registry } from "../Registry";

test("chooseBestDigest", () => {
  expect(Registry.chooseBestDigest([])).toBe("0");

  expect(Registry.chooseBestDigest(["1.deadbeef", "2.deadbeef"])).toBe(
    "2.deadbeef",
  );

  expect(
    Registry.chooseBestDigest(["before-undo", "2.deadbeef", "after-undo"]),
  ).toBe("2.deadbeef");

  expect(Registry.chooseBestDigest(["before-undo", "after-undo"])).toBe(
    "0.after-undo",
  );

  expect(
    Registry.chooseBestDigest(["2.deadbeef", "3.deadbeef", "1.deadbeef"]),
  ).toBe("3.deadbeef");
});
