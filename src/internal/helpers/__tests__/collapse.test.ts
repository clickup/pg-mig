import { collapse } from "../collapse";

test("collapse", () => {
  expect(collapse(["host:sh0000"])).toEqual(["host:sh0000"]);
  expect(collapse(["host:sh0001", "host:sh0002", "host:sh0003"])).toEqual([
    "host:sh0001-0003",
  ]);
  expect(collapse(["host:sh0001", "host:sh0002", "host:sh0003"])).toEqual([
    "host:sh0001-0003",
  ]);
  expect(collapse(["host:sh0001", "host:sh0003"])).toEqual([
    "host:sh0001,0003",
  ]);
  expect(
    collapse([
      "host:sh0001",
      "host:sh0002",
      "host:sh0003",
      "host:sh0008",
      "host:sh0009",
      "other:01",
      "other:02",
      "other:03",
    ]),
  ).toEqual(["host:sh0001-0003,0008-0009", "other:01-03"]);
  expect(collapse(["host:public", "host:some"])).toEqual([
    "host:public",
    "host:some",
  ]);
});
