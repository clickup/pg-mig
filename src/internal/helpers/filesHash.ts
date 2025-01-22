import crypto from "crypto";
import { readFileSync } from "fs";

export function filesHash(fileNames: string[]): string {
  const contents = fileNames.map((fileName) =>
    readFileSync(fileName).toString(),
  );
  return crypto.createHash("sha256").update(contents.join("\n")).digest("hex");
}
