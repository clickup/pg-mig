import { Dest } from "../Dest";

test("special characters in user/password", () => {
  const dest = Dest.create("localhost/mydb", {
    user: "a/b",
    pass: "c/d",
  });
  expect(dest.user).toBe("a/b");
  expect(dest.pass).toBe("c/d");
});

test("special characters in host", () => {
  const dest1 = Dest.create("local*host", {
    user: "a",
    pass: "c",
    db: "e/f",
  });
  expect(dest1.host).toBe("local*host");
  expect(dest1.db).toBe("e/f");

  const dest2 = Dest.create("/db", {
    user: "a",
    pass: "c",
    host: "local*host",
  });
  expect(dest2.host).toBe("local*host");
  expect(dest2.db).toBe("db");
});

test("special characters in db", () => {
  const dest = Dest.create("localhost", {
    user: "a",
    pass: "c",
    db: "e?f",
  });
  expect(dest.db).toBe("e?f");
});
