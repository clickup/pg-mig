import { basename } from "path";
import chalk from "chalk";
import compact from "lodash/compact";
import sortBy from "lodash/sortBy";
import sum from "lodash/sum";
import type { Dest } from "./Dest";
import type { Grid } from "./Grid";
import { collapse } from "./helpers/collapse";
import { DefaultMap } from "./helpers/DefaultMap";
import { promiseAllMap } from "./helpers/promiseAllMap";
import type { Chain } from "./Patch";
import type { Registry } from "./Registry";

const Table = require("table-layout");

const lengthsByGrid = new WeakMap<
  Grid,
  {
    succeededMigrations: number;
    errorMigrations: number;
    destName: number;
    destSchema: number;
    migrationVersion: number;
    prefix: number;
  }
>();

export function renderGrid(
  grid: Grid,
  skipEmptyLines: boolean,
): {
  lines: string[];
  errors: string[];
  warnings: string[];
} {
  let lengths = lengthsByGrid.get(grid);
  if (!lengths) {
    const chains = [...grid.chains, ...grid.beforeChains, ...grid.afterChains];
    const versionLengths = sortBy(
      chains.flatMap((chain) =>
        chain.migrations.map((migration) => migration.version.length),
      ),
    );
    lengths = {
      succeededMigrations: 4,
      errorMigrations: 3,
      destName: Math.max(
        ...chains.map((chain) => chain.dest.name("short").length),
      ),
      destSchema: Math.max(...chains.map((chain) => chain.dest.schema.length)),
      migrationVersion:
        versionLengths[Math.floor(versionLengths.length * 0.8)] || 1,
      prefix: 0,
    };
    lengths.prefix =
      sum(Object.values(lengths)) + Object.values(lengths).length;
    lengthsByGrid.set(grid, lengths);
  }

  const activeRows: string[][] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const worker of sortBy(
    grid.workers,
    (worker) => worker.curDest?.name(),
    (worker) => worker.curDest?.schema,
  )) {
    if (worker.curDest && (!skipEmptyLines || worker.curLine?.trim())) {
      activeRows.push([
        chalk.green(
          worker.succeededMigrations
            .toString()
            .padStart(lengths.succeededMigrations),
        ),
        worker.errorMigrations.length
          ? chalk.red(
              worker.errorMigrations.length
                .toString()
                .padStart(lengths.errorMigrations),
            )
          : chalk.gray("0".padStart(lengths.errorMigrations)),
        worker.curDest.name("short").padEnd(lengths.destName),
        worker.curDest.schema.padEnd(lengths.destSchema),
        worker
          .curMigration!.version.substring(0, lengths.migrationVersion)
          .padEnd(lengths.migrationVersion),
        worker.curLine?.trimEnd() || "",
      ]);
    }

    for (const { dest, migration, payload } of worker.errorMigrations) {
      errors.push(
        chalk.red("#") +
          " " +
          chalk.red(dest.toString() + " <- " + migration.version) +
          "\n" +
          ("" + payload).replace(/^/gm, "  ").trimEnd(),
      );
    }

    for (const { dest, migration, payload } of worker.warningMigrations) {
      warnings.push(
        chalk.yellow("#") +
          " " +
          chalk.yellow(dest.toString() + " <- " + migration.version) +
          "\n" +
          ("" + payload).replace(/^/gm, "  ").trimEnd(),
      );
    }
  }

  const { processedMigrations, totalMigrations, elapsedSeconds } = grid;
  const leftMigrations = Math.max(totalMigrations - processedMigrations, 0);
  const percentDone =
    totalMigrations > 0 && processedMigrations <= totalMigrations
      ? Math.round((processedMigrations / totalMigrations) * 100)
      : "100";
  const leftSeconds =
    processedMigrations > 0
      ? Math.round((elapsedSeconds / processedMigrations) * leftMigrations) +
        "s left"
      : "";
  const qps =
    elapsedSeconds > 0
      ? Math.round((processedMigrations / elapsedSeconds) * 100) / 100 +
        " migrations/s"
      : "";

  const tableOptions = {
    maxWidth: process.stdout.columns
      ? Math.max(process.stdout.columns - 2, lengths.prefix + 30)
      : 1000000,
    padding: { right: "  ", left: "" },
  };
  const lines = compact([
    activeRows.length > 0 &&
      "Migrating: " +
        [
          percentDone + "%",
          Math.round(elapsedSeconds) + "s elapsed",
          leftSeconds,
          qps,
        ]
          .filter((v) => v.length > 0)
          .join(", "),
    // Render each row as an independent table, in sake of just wrapping the
    // long worker.curLine strings.
    ...activeRows.map((row) =>
      new Table([row], tableOptions).toString().trimRight(),
    ),
    ...errors,
    ...warnings,
  ]);
  return { lines, errors, warnings };
}

export function renderPatchSummary(
  chains: Chain[],
  beforeAfterFiles: string[],
): string {
  const destsGrouped = new DefaultMap<string, string[]>();
  for (const chain of chains) {
    const key =
      (chain.type === "dn" ? "(undo) " : "") +
      chain.migrations.map((ver) => ver.version).join(", ");
    destsGrouped
      .getOrAdd(key, [])
      .push(chain.dest.name("short") + ":" + chain.dest.schema);
  }

  const rows = [];
  for (const [key, dests] of destsGrouped) {
    rows.push(collapse(dests) + ": " + key);
  }

  return chalk.yellow(
    "Migration versions to apply:\n" +
      compact([
        ...(rows.length ? rows : ["<no new migration versions>"]),
        beforeAfterFiles.map((fileName) => basename(fileName)).join(", "),
      ])
        .map((s) => "  * " + s)
        .join("\n"),
  );
}

export async function renderLatestVersions(
  dests: Dest[],
  registry: Registry,
): Promise<string> {
  const destsGrouped = new DefaultMap<string, string[]>();
  await promiseAllMap(dests, async (dest) => {
    const allSchemas = await dest.loadSchemas();
    const reEntries = registry.groupBySchema(allSchemas);
    const schemas = Array.from(reEntries.keys());
    const versionsBySchema = await dest.loadVersionsBySchema(schemas);
    for (const [schema, versions] of versionsBySchema) {
      destsGrouped
        .getOrAdd(versions[versions.length - 1] || "", [])
        .push(dest.name("short") + ":" + schema);
    }
  });
  const rows = [];
  for (const [key, dests] of sortBy(
    Array.from(destsGrouped),
    ([key]) => key,
  ).reverse()) {
    rows.push(collapse(dests) + ": " + (key || "<no versions>"));
  }

  return (
    "Existing latest versions in the DB:\n" +
    (rows.length ? rows : ["<empty>"]).map((s) => "  * " + s).join("\n")
  );
}

export function printText(text: string): void {
  // eslint-disable-next-line no-console
  return console.log(text);
}

export function printSuccess(text: string): void {
  return printText(chalk.green(text));
}

export function printError(e: unknown): void {
  return printText(
    chalk.red(
      e instanceof Error
        ? (e.stack ?? e.message).trim()
        : typeof e === "string" && !e.includes("\n")
          ? `Error: ${e}`
          : "" + e,
    ),
  );
}
