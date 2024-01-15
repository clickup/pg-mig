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
    undo: args.getOptional("undo"),
    make: args.getOptional("make"),
    parallelism: parseInt(args.get("parallelism", "0")) || undefined,
    dry: args.flag("dry"),
    list: args.flag("list"),
    ci: args.flag("ci"),
  });
}

/**
 * Similar to main(), but accepts options explicitly, not from process.argv.
 * This function is meant to be called from other tools.
 */
export async function migrate(options: {
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
  /** If passed, switches the action to undo the provided migration version. */
  undo?: string;
  /** If passed, switches the action to create a new migration version. */
  make?: string;
  /** If true, prints what it plans to do, but doesn't change anything. */
  dry?: boolean;
  /** Lists all versions in `migDir`. */
  list?: boolean;
  /** If true, then doesn't use logUpdate() and doesn't replace lines; instead,
   * prints logs to stdout line by line. */
  ci?: boolean;
}): Promise<boolean> {
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
  const registry = new Registry(options.migDir);

  printText(`Running on ${options.hosts}:${options.port} ${options.db}`);

  if (options.make !== undefined) {
    // example: create_table_x@sh
    const [migrationName, schemaPrefix] = options.make.split("@");
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

  if (options.list) {
    printText("All versions:");

    for (const version of sortBy(registry.getVersions())) {
      printText(` > ${version}`);
    }

    return true;
  }

  if (options.undo === "") {
    printText(await renderLatestVersions(hostDests, registry));
    printError("Please provide a migration version to undo.");
    return false;
  }

  const patch = new Patch(hostDests, registry, { undo: options.undo });
  const chains = await patch.getChains();

  const [summary, hasWork] = renderPatchSummary(chains);
  if (!hasWork || options.dry) {
    printText(await renderLatestVersions(hostDests, registry));
    printText(summary);
    return true;
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

  const success = await grid.run(
    throttle(() => {
      const lines = renderGrid(grid).split("\n");
      if (!options.ci) {
        logUpdate(lines.slice(0, (process.stdout.rows || 20) - 1).join("\n"));
      }
    }, 100),
  );
  if (!options.ci) {
    logUpdate.clear();
  }

  const errors = renderGrid(grid);
  if (errors) {
    printText("\n" + errors);
    printError("Failed");
  } else {
    printSuccess("Succeeded.");
  }

  return success;
}

if (require.main === module) {
  main()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((e) => {
      printError(e);
      process.exit(1);
    });
}
