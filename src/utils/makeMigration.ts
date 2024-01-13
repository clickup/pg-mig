import { writeFileSync } from "fs";
import { join } from "path";
import moment from "moment";

export async function makeMigration(
  migrationDir: string,
  migrationName: string,
  schemaPrefix: string,
) {
  const utcTimestamp = moment(Date.now()).utc().format("YYYYMMDDHHmmss");

  const migrationFilenameBase = `${utcTimestamp}.${migrationName}.${schemaPrefix}`;
  const migrationFiles = [
    `${migrationFilenameBase}.up.sql`,
    `${migrationFilenameBase}.dn.sql`,
  ].map((f) => join(migrationDir, f));

  migrationFiles.forEach((f) => {
    writeFileSync(f, "", {
      mode: 0o644,
    });
  });

  return migrationFiles;
}
