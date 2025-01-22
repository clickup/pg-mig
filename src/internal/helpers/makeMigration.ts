import { writeFileSync } from "fs";
import { join } from "path";
import moment from "moment";

export async function makeMigration(
  migrationDir: string,
  migrationName: string,
  schemaPrefix: string,
): Promise<string[]> {
  const utcTimestamp = moment(Date.now()).utc().format("YYYYMMDDHHmmss");

  const migrationFilenameBase = `${utcTimestamp}.${migrationName}.${schemaPrefix}`;
  const migrationFiles = [
    `${migrationFilenameBase}.up.sql`,
    `${migrationFilenameBase}.dn.sql`,
  ].map((f) => join(migrationDir, f));

  for (const f of migrationFiles) {
    writeFileSync(f, "", { mode: 0o644 });
  }

  return migrationFiles;
}
