#!/usr/bin/env node
import { basename } from "path";
import sortBy from "lodash/sortBy";
import throttle from "lodash/throttle";
import logUpdate from "log-update";
import { Dest } from "./internal/Dest";
import { Grid } from "./internal/Grid";
import { Args } from "./internal/helpers/Args";
import { makeMigration } from "./internal/helpers/makeMigration";
import type { Chain } from "./internal/Patch";
import { Patch } from "./internal/Patch";
import { Registry } from "./internal/Registry";
import {
  printError,
  printSuccess,
  printText,
  renderGrid,
  renderLatestVersions,
  renderPatchSummary,
} from "./internal/render";

/**
 * Options for the migrate() function.
 */
export interface MigrateOptions {
  /** The directory the migration versions are loaded from. */
  migDir: string;
  /** List of PostgreSQL master hostnames. The migration versions in `migDir`
   * will be applied to all of them. */
  hosts: string[];
  /** PostgreSQL port on each hosts. */
  port: number;
  /** PostgreSQL user on each host. */
  user: string;
  /** PostgreSQL password on each host. */
  pass: string;
  /** PostgreSQL database name on each host. */
  db: string;
  /** How many schemas to process in parallel (defaults to 10). */
  parallelism?: number;
  /** If true, prints what it plans to do, but doesn't change anything. */
  dry?: boolean;
  /** If true, then doesn't use log-update and doesn't replace lines; instead,
   * prints logs to stdout line by line. */
  ci?: boolean;
  /** What to do. */
  action:
    | { type: "make"; name: string }
    | { type: "list" }
    | { type: "undo"; version: string }
    | { type: "apply" };
}

/**
 * CLI tool entry point. This function is run when `pg-mig` is called from the
 * command line. Accepts parameters from process.argv. See `migrate()` for
 * option names.
 *
 * If no options are passed, uses `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
 * `PGDATABASE` environment variables which are standard for e.g. `psql`.
 *
 * You can pass multiple hosts separated by comma or semicolon.
 *
 * Examples:
 * ```
 * pg-mig --make=my-migration-name@sh
 * pg-mig --make=other-migration-name@sh0000
 * pg-mig --undo 20191107201239.my-migration-name.sh
 * pg-mig
 * ```
 */
export async function main(): Promise<boolean> {
  const args = new Args(
    process.argv,
    // Notice that we use --migdir and not --dir, because @mapbox/node-pre-gyp
    // used by bcrypt conflicts with --dir option.
    [
      "migdir",
      "hosts",
      "port",
      "user",
      "pass",
      "db",
      "undo",
      "make",
      "parallelism",
    ],
    ["dry", "ci", "list"],
  );
  return migrate({
    migDir: args.get("migdir", process.env["PGMIGDIR"]),
    hosts: args
      .get("hosts", process.env["PGHOST"] || "127.0.0.1")
      .split(/[\s,;]+/),
    port: parseInt(args.get("port", process.env["PGPORT"] || "5432")),
    user: args.get("user", process.env["PGUSER"] || ""),
    pass: args.get("pass", process.env["PGPASSWORD"] || ""),
    db: args.get("db", process.env["PGDATABASE"]),
    parallelism: parseInt(args.get("parallelism", "0")) || undefined,
    dry: args.flag("dry"),
    ci: args.flag("ci"),
    action:
      args.getOptional("make") !== undefined
        ? { type: "make", name: args.get("make") }
        : args.flag("list")
          ? { type: "list" }
          : args.getOptional("undo") !== undefined
            ? { type: "undo", version: args.get("undo") }
            : { type: "apply" },
  });
}

/**
 * Similar to main(), but accepts options explicitly, not from process.argv.
 * This function is meant to be called from other tools.
 */
export async function migrate(options: MigrateOptions): Promise<boolean> {
  const registry = new Registry(options.migDir);

  printText(`Running on ${options.hosts}:${options.port} ${options.db}`);

  if (options.action.type === "make") {
    return actionMake(options, registry, options.action.name);
  }

  if (options.action.type === "list") {
    return actionList(options, registry);
  }

  while (true) {
    const { success, hasMoreWork } = await actionUndoOrApply(options, registry);
    if (!success || !hasMoreWork) {
      return success;
    }
  }
}

/**
 * Makes new migration files.
 */
async function actionMake(
  options: Exclude<MigrateOptions, "action">,
  registry: Registry,
  name: string,
): Promise<boolean> {
  const [migrationName, schemaPrefix] = name.split("@");
  const usage = "Format: --make=migration_name@schema_prefix";

  if (!migrationName?.match(/^[a-z0-9_]+$/)) {
    printError("migration_name is missing or incorrect");
    printText(usage);
    return false;
  }

  if (!schemaPrefix) {
    printError("schema_prefix is missing");
    printText(usage);
    return false;
  }

  if (!registry.prefixes.includes(schemaPrefix)) {
    printText(
      `WARNING: schema prefix "${schemaPrefix}" wasn't found. Valid prefixes:`,
    );
    for (const prefix of registry.prefixes) {
      printText(`- ${prefix}`);
    }
  }

  printText("\nMaking migration files...");
  const createdFiles = await makeMigration(
    options.migDir,
    migrationName,
    schemaPrefix,
  );
  for (const file of createdFiles) {
    printText(file);
  }

  return true;
}

/**
 * Prints the list of all migration versions in the registry.
 */
async function actionList(
  _options: MigrateOptions,
  registry: Registry,
): Promise<boolean> {
  printText("All versions:");

  for (const version of sortBy(registry.getVersions())) {
    printText(` > ${version}`);
  }

  return true;
}

/**
 * Applies or undoes migrations.
 */
async function actionUndoOrApply(
  options: MigrateOptions,
  registry: Registry,
): Promise<{ success: boolean; hasMoreWork: boolean }> {
  const hostDests = options.hosts.map(
    (host) =>
      new Dest(
        host,
        options.port,
        options.user,
        options.pass,
        options.db,
        "public",
      ),
  );

  if (options.action.type === "undo" && !options.action.version) {
    printText(await renderLatestVersions(hostDests, registry));
    printError("Please provide a migration version to undo.");
    return { success: false, hasMoreWork: false };
  }

  const patch = new Patch(hostDests, registry, {
    undo: options.action.type === "undo" ? options.action.version : undefined,
  });
  const chains = await patch.getChains();

  const summary = renderPatchSummary(chains);
  if (chains.length === 0 || options.dry) {
    printText(await renderLatestVersions(hostDests, registry));
    printText(summary);
    return { success: true, hasMoreWork: false };
  }

  printText(summary);

  const beforeChains: Chain[] = registry.beforeFile
    ? hostDests.map((dest) => ({
        type: "dn",
        dest,
        migrations: [
          {
            version: basename(registry.beforeFile!.fileName),
            file: registry.beforeFile!,
            newVersions: null,
          },
        ],
      }))
    : [];
  const afterChains: Chain[] = registry.afterFile
    ? hostDests.map((dest) => ({
        type: "up",
        dest,
        migrations: [
          {
            version: basename(registry.afterFile!.fileName),
            file: registry.afterFile!,
            newVersions: null,
          },
        ],
      }))
    : [];
  const grid = new Grid(
    chains,
    options.parallelism ?? 10,
    beforeChains,
    afterChains,
  );

  const progress = options.ci
    ? null
    : logUpdate.create(process.stdout, { showCursor: true });

  const success = await grid.run(
    throttle(() => {
      const lines = renderGrid(grid);
      if (lines.length > 0) {
        progress?.(
          lines
            .slice(0, Math.max((process.stdout.rows || 25) - 3, 3))
            .join("\n"),
        );
      } else {
        progress?.clear();
      }
    }, 100),
  );
  progress?.clear();

  const errors = renderGrid(grid);
  if (errors.length > 0) {
    printText("\n" + errors);
    printError("Failed");
  } else {
    printSuccess("Succeeded.");
  }

  return {
    success,
    hasMoreWork:
      options.action.type === "apply" && success
        ? (await patch.getChains()).length > 0
        : false,
  };
}

/**
 * Entry point for the CLI tool.
 */
if (require.main === module) {
  main()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((e) => {
      printError(e);
      process.exit(1);
    });
}
