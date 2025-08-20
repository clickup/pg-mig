import { writeFileSync } from "fs";
import { join } from "path";
import compact from "lodash/compact";
import max from "lodash/max";
import moment from "moment";
import type { MigrateOptions } from "../cli";
import { Registry } from "../internal/Registry";
import { printError, printText } from "../internal/render";
import { actionChain } from "./actionChain";

/**
 * Makes new migration files.
 */
export async function actionMake(
  options: Exclude<MigrateOptions, "action">,
  registry: Registry,
  name: string,
): Promise<boolean> {
  const [migrationName, schemaPrefix] = name.split("@");
  const usage = "Format: --make=migration_name@schema_prefix";

  if (!migrationName?.match(/^[-a-z0-9_]+$/)) {
    printError("migration_name is missing or includes incorrect characters");
    printText(usage);
    return false;
  }

  if (!schemaPrefix) {
    printError("schema_prefix is missing");
    printText(usage);
    return false;
  }

  if (!registry.getPrefixes().includes(schemaPrefix)) {
    printText(
      `WARNING: schema prefix "${schemaPrefix}" wasn't found. Valid prefixes:`,
    );
    for (const prefix of registry.getPrefixes()) {
      printText(`- ${prefix}`);
    }
  }

  printText("Making migration files...");
  const createdFiles = await makeMigration(
    options.migDir,
    migrationName,
    schemaPrefix,
    max(compact(registry.getVersions().map((v) => v.match(/^(\d+)\./)?.[1]))) ??
      null,
  );

  registry = new Registry(registry.dir);
  await actionChain(options, registry);

  printText("Created files:");
  for (const file of createdFiles) {
    printText(file);
  }

  return true;
}

async function makeMigration(
  migrationDir: string,
  migrationName: string,
  schemaPrefix: string,
  maxUtcTimestamp: string | null,
): Promise<string[]> {
  let utcTimestamp = moment(Date.now()).utc().format("YYYYMMDDHHmmss");

  // In case we have skewed timestamp in the existing versions (like 20251424:
  // there is no month 14), we just add one minute to the last version timestamp
  // instead of using the current time.
  if (maxUtcTimestamp && utcTimestamp <= maxUtcTimestamp) {
    utcTimestamp = String(Number(maxUtcTimestamp) + 60);
  }

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
