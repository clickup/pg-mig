import colors from "colors";
import sortBy from "lodash/sortBy";
import type { Dest } from "./Dest";
import type { Grid } from "./Grid";
import type { Chain } from "./Patch";
import type { Registry } from "./Registry";
import { collapse } from "./utils/collapse";
import { DefaultMap } from "./utils/DefaultMap";

const Table = require("table-layout");

const MIN_WIDTH = 110;
process.stdout.columns = Math.max(process.stdout.columns || 0, MIN_WIDTH);
process.stderr.columns = Math.max(process.stderr.columns || 0, MIN_WIDTH);
const TABLE_OPTIONS = {
  maxWidth: process.stdout.columns - 2,
};

export function renderGrid(grid: Grid) {
  const activeRows: string[][] = [];
  const errorRows: string[][] = [];
  for (const worker of sortBy(
    grid.workers,
    (worker) => worker.curDest?.host,
    (worker) => worker.curDest?.schema
  )) {
    if (worker.curDest) {
      activeRows.push([
        colors.green("  " + worker.succeededMigrations),
        worker.errorMigrations.length
          ? colors.red(worker.errorMigrations.length + "")
          : colors.gray("0"),
        formatHost(worker.curDest.host),
        worker.curDest.schema,
        worker.curMigration!.version,
        worker.curLine || "",
      ]);
    }

    for (const { dest, migration, error } of worker.errorMigrations) {
      errorRows.push([
        colors.red("#"),
        colors.red(dest.toString() + " <- " + migration.version),
      ]);
      errorRows.push(["", ("" + error).trimEnd()]);
      errorRows.push(["", ""]);
    }
  }

  const table1 = new Table(activeRows, {
    ...TABLE_OPTIONS,
    padding: { right: "  ", left: "" },
  });
  const table2 = new Table(errorRows, {
    ...TABLE_OPTIONS,
    padding: { right: " ", left: "" },
  });

  const { processedMigrations, totalMigrations, elapsedSeconds } = grid;
  const leftMigrations = totalMigrations - processedMigrations;
  const percentDone =
    totalMigrations > 0
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

  return (
    (activeRows.length > 0
      ? "Running: " +
        [
          percentDone + "%",
          Math.round(elapsedSeconds) + "s elapsed",
          leftSeconds,
          qps,
        ]
          .filter((v) => v.length > 0)
          .join(", ") +
        "\n" +
        table1.toString() +
        "\n"
      : "") + (errorRows.length > 0 ? table2.toString().trimEnd() + "\n" : "")
  );
}

export function renderPatchSummary(chains: Chain[]): [string, boolean] {
  const destsGrouped = new DefaultMap<string, string[]>();
  for (const chain of chains) {
    const key =
      (chain.type === "dn" ? "(undo) " : "") +
      chain.migrations.map((ver) => ver.version).join(", ");
    destsGrouped
      .getOrAdd(key, [])
      .push(formatHost(chain.dest.host) + ":" + chain.dest.schema);
  }

  const rows = [];
  for (const [key, dests] of destsGrouped) {
    rows.push(collapse(dests) + ": " + key);
  }

  return [
    colors.yellow(
      "Migrations to apply:\n" +
        (rows.length ? rows : ["<no changes>"])
          .map((s) => "  * " + s)
          .join("\n")
    ),
    rows.length > 0,
  ];
}

export async function renderLatestVersions(dests: Dest[], registry: Registry) {
  const destsGrouped = new DefaultMap<string, string[]>();
  await Promise["all"](
    dests.map(async (dest) => {
      const allSchemas = await dest.loadSchemas();
      const reEntries = registry.groupBySchema(allSchemas);
      const schemas = Array.from(reEntries.keys());
      const versionsBySchema = await dest.loadVersionsBySchema(schemas);
      for (const [schema, versions] of versionsBySchema) {
        destsGrouped
          .getOrAdd(versions[versions.length - 1] || "", [])
          .push(formatHost(dest.host) + ":" + schema);
      }
    })
  );
  const rows = [];
  for (const [key, dests] of sortBy(
    Array.from(destsGrouped),
    ([key]) => key
  ).reverse()) {
    rows.push(collapse(dests) + ": " + (key || "<no versions>"));
  }

  return (
    "Existing latest versions in the DB:\n" +
    (rows.length ? rows : ["<empty>"]).map((s) => "  * " + s).join("\n")
  );
}

export function printText(text: string) {
  // eslint-disable-next-line no-console
  return console.log(text);
}

export function printSuccess(text: string) {
  return printText(colors.green("" + text));
}

export function printError(error: any) {
  return printText(colors.red("Error: " + error));
}

function formatHost(host: string) {
  return host.match(/^\d+\.\d+\.\d+\.\d+$/) ? host : host.replace(/\..*/, "");
}
