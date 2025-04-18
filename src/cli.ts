#!/usr/bin/env node
import { basename } from "path";
import compact from "lodash/compact";
import mapValues from "lodash/mapValues";
import pickBy from "lodash/pickBy";
import sortBy from "lodash/sortBy";
import { Dest } from "./internal/Dest";
import { Grid } from "./internal/Grid";
import { Args } from "./internal/helpers/Args";
import { makeMigration } from "./internal/helpers/makeMigration";
import { readConfigs } from "./internal/helpers/readConfigs";
import type { Chain } from "./internal/Patch";
import { Patch } from "./internal/Patch";
import {
  ProgressPrinterStream,
  ProgressPrinterTTY,
} from "./internal/ProgressPrinter";
import { Registry } from "./internal/Registry";
import {
  printError,
  printSuccess,
  printText,
  renderGrid,
  renderLatestVersions,
  renderPatchSummary,
} from "./internal/render";

const MIN_TTY_ROWS = 5;

/**
 * Options for the migrate() function.
 */
export interface MigrateOptions {
  /** The directory the migration versions are loaded from. */
  migDir: string;
  /** List of PostgreSQL master hostnames or DSNs in the format:
   * "host[:port][/database]" or
   * "postgres://[user][:password][@]host[:port][/database]". The migration
   * versions in `migDir` will be applied to all of them. */
  hosts: string[];
  /** PostgreSQL port on each hosts. */
  port?: number;
  /** PostgreSQL user on each host. */
  user?: string;
  /** PostgreSQL password on each host. */
  pass?: string;
  /** PostgreSQL database name on each host. */
  db?: string;
  /** If true, tries to create the given database. This is helpful when running
   * the tool on a developer's machine. */
  createDB?: boolean;
  /** How many schemas to process in parallel (defaults to 10). */
  parallelism?: number;
  /** If true, prints what it plans to do, but doesn't change anything. */
  dry?: boolean;
  /** If true, runs before/after files on apply even if nothing is changed. */
  force?: boolean;
  /** What to do. */
  action:
    | { type: "make"; name: string }
    | { type: "list" }
    | { type: "digest" }
    | { type: "undo"; version: string }
    | { type: "apply"; after?: Array<() => void | Promise<void>> };
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
 * pg-mig --undo=20191107201239.my-migration-name.sh
 * pg-mig --list
 * pg-mig --list=digest
 * pg-mig
 * ```
 */
export async function main(argsIn: string[]): Promise<boolean> {
  const args = new Args(
    argsIn,
    [
      // We use --migdir and not --dir, because @mapbox/node-pre-gyp used by
      // bcrypt conflicts with --dir option.
      "migdir",
      "hosts",
      "port",
      "user",
      "pass",
      "db",
      "undo",
      "make",
      "list",
      "parallelism",
    ],
    ["dry", "createdb", "force", "skip-config"],
  );

  const action: MigrateOptions["action"] =
    args.getOptional("make") !== undefined
      ? { type: "make", name: args.get("make") }
      : args.getOptional("list") === ""
        ? { type: "list" }
        : args.getOptional("list") === "digest"
          ? { type: "digest" }
          : args.getOptional("undo") !== undefined
            ? { type: "undo", version: args.get("undo") }
            : { type: "apply", after: [] };

  if (!args.flag("skip-config")) {
    for (const config of await readConfigs("pg-mig.config", action.type)) {
      Object.assign(
        process.env,
        mapValues(
          pickBy(
            config,
            (v) =>
              typeof v === "string" ||
              typeof v === "number" ||
              typeof v === "boolean",
          ),
          String,
        ),
      );
      if (action.type === "apply") {
        if ("after" in config && typeof config.after === "function") {
          action.after!.push(config.after as () => void | Promise<void>);
        }
      }
    }
  }

  return migrate({
    migDir: args.get("migdir", process.env["PGMIGDIR"]),
    hosts: compact(
      args
        .get("hosts", process.env["PGHOST"] || "127.0.0.1")
        .split(/[\s,;]+/)
        .map((host) => host.trim()),
    ),
    port: parseInt(args.get("port", process.env["PGPORT"] || "")) || undefined,
    user: args.get("user", process.env["PGUSER"] || "") || undefined,
    pass: args.get("pass", process.env["PGPASSWORD"] || "") || undefined,
    db: args.get("db", process.env["PGDATABASE"] || "") || undefined,
    createDB:
      args.flag("createdb") ||
      ![undefined, null, "", "0", "false", "undefined", "null", "no"].includes(
        process.env["PGCREATEDB"],
      ),
    parallelism: parseInt(args.get("parallelism", "0")) || undefined,
    dry: args.flag("dry"),
    force: args.flag("force"),
    action,
  });
}

/**
 * Similar to main(), but accepts options explicitly, not from process.argv.
 * This function is meant to be called from other tools.
 */
export async function migrate(options: MigrateOptions): Promise<boolean> {
  const registry = new Registry(options.migDir);

  if (options.action.type === "digest") {
    return actionDigest(options, registry);
  }

  if (options.hosts.length === 0) {
    throw "No hosts provided.";
  }

  const hostDests = options.hosts.map((host) => Dest.create(host, options));

  // Available in *.sql migration version files.
  process.env["PG_MIG_HOSTS"] = hostDests
    .map((dest) => dest.hostSpec())
    .join(",");

  const portIsSignificant = hostDests.some(
    (dest) => dest.port !== hostDests[0].port,
  );
  const dbIsSignificant = hostDests.some((dest) => dest.db !== hostDests[0].db);
  for (const dest of hostDests) {
    dest.setSignificance({ portIsSignificant, dbIsSignificant });
  }

  printText(
    compact([
      "Running on " + hostDests.map((dest) => dest.name()).join(","),
      !portIsSignificant && `port ${hostDests[0].port}`,
      !dbIsSignificant && `db ${hostDests[0].db}`,
    ]).join(", "),
  );

  if (options.action.type === "make") {
    return actionMake(options, registry, options.action.name);
  }

  if (options.action.type === "list") {
    return actionList(options, registry);
  }

  while (true) {
    const { success, hasMoreWork } = await actionUndoOrApply(
      options,
      hostDests,
      registry,
    );

    if (
      !options.dry &&
      options.action.type === "apply" &&
      success &&
      !hasMoreWork
    ) {
      for (const after of options.action.after ?? []) {
        await after();
      }
    }

    if (!success || !hasMoreWork) {
      return success;
    }
  }
}

/**
 * Loads the digest strings from the provided databases and chooses the one
 * which reflects the database schema status the best.
 */
export async function loadDBDigest<TDest>(
  dests: TDest[],
  sqlRunner: (
    dest: TDest,
    sql: string,
  ) => Promise<Array<Record<string, string>>>,
): Promise<string> {
  const digests = await Dest.loadDigests(dests, sqlRunner);
  return Registry.chooseBestDigest(digests);
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

  if (!registry.prefixes.includes(schemaPrefix)) {
    printText(
      `WARNING: schema prefix "${schemaPrefix}" wasn't found. Valid prefixes:`,
    );
    for (const prefix of registry.prefixes) {
      printText(`- ${prefix}`);
    }
  }

  printText("Making migration files...");
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
 * Prints the "code digest", of all migration version names on disk. Digest is a
 * string, and those strings can be compared lexicographically to determine
 * whether the code version is compatible with the DB version: if the DB's
 * digest is greater or equal to the code's digest, then they are compatible, so
 * the code can be deployed.
 */
async function actionDigest(
  _options: MigrateOptions,
  registry: Registry,
): Promise<boolean> {
  printText(registry.getDigest());
  return true;
}

/**
 * Applies or undoes migrations.
 */
async function actionUndoOrApply(
  options: MigrateOptions,
  hostDests: Dest[],
  registry: Registry,
): Promise<{ success: boolean; hasMoreWork: boolean }> {
  const digest = registry.getDigest();

  if (options.action.type === "apply" && options.createDB) {
    for (const dest of hostDests) {
      await dest
        .createDB((e) =>
          printText(
            `PostgreSQL host ${dest.name()} is not yet up; waiting (${e})...`,
          ),
        )
        .then(
          (status) =>
            status === "created" &&
            printText(`Database ${dest.name()} did not exist; created.`),
        );
    }
  }

  if (options.action.type === "undo" && !options.action.version) {
    printText(await renderLatestVersions(hostDests, registry));
    printError("Please provide a migration version to undo.");
    return { success: false, hasMoreWork: false };
  }

  const patch = new Patch(hostDests, registry, {
    undo: options.action.type === "undo" ? options.action.version : undefined,
  });
  const chains = await patch.getChains();

  // If we are going to undo something, reset the digest in the DB before
  // running the down migrations, so if we fail partially, the digest in the DB
  // will be reset.
  if (options.action.type === "undo" && chains.length > 0 && !options.dry) {
    await Dest.saveDigests(hostDests, { reset: "before-undo" });
  }

  const beforeAfterFiles = compact([
    registry.beforeFile?.fileName,
    registry.afterFile?.fileName,
  ]);

  if (
    chains.length === 0 &&
    (await Dest.checkRerunFingerprint(hostDests, beforeAfterFiles)) &&
    !options.force
  ) {
    // If we have nothing to apply, save the digest in case it was not saved
    // previously, to keep the invariant.
    if (options.action.type === "apply" && !options.dry) {
      await Dest.saveDigests(hostDests, { digest });
    }

    printText(await renderLatestVersions(hostDests, registry));
    printText(renderPatchSummary(chains, []));
    printSuccess("Nothing to do.");
    return { success: true, hasMoreWork: false };
  }

  if (options.dry) {
    printText(await renderLatestVersions(hostDests, registry));
    printText(renderPatchSummary(chains, beforeAfterFiles));
    printSuccess("Dry-run mode.");
    return { success: true, hasMoreWork: false };
  }

  printText(renderPatchSummary(chains, beforeAfterFiles));

  // Remember that if we crash below (e.g. in after.sql), we'll need to run
  // before.sql+after.sql on retry even if there are no new migration versions
  await Dest.saveRerunFingerprint(hostDests, beforeAfterFiles, "reset");

  const grid = new Grid(
    chains,
    options.parallelism ?? 10,
    registry.beforeFile
      ? hostDests.map<Chain>((dest) => ({
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
      : [],
    registry.afterFile
      ? hostDests.map<Chain>((dest) => ({
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
      : [],
  );
  const progress =
    process.stdout.isTTY &&
    process.stdout.rows &&
    process.stdout.rows >= MIN_TTY_ROWS
      ? new ProgressPrinterTTY()
      : new ProgressPrinterStream();
  const success = await grid.run(
    progress.throttle(() =>
      progress.print(renderGrid(grid, progress.skipEmptyLines()).lines),
    ),
  );
  progress.clear();

  const { lines, errors, warnings } = renderGrid(grid, true);
  if (errors.length > 0) {
    printError("\n###\n### FAILED. See complete error list below.\n###\n");
    printText(lines.join("\n"));
    printError(`Failed with ${errors.length} error(s).`);
  } else if (warnings.length > 0) {
    printText(
      "\n###\n### SUCCEEDED with warnings. See complete warning list below.\n###\n",
    );
    printText(lines.join("\n"));
    printSuccess(`Succeeded with ${warnings.length} warning(s).`);
  } else {
    printSuccess("Succeeded.");
  }

  if (!success) {
    return { success: false, hasMoreWork: false };
  }

  await Dest.saveRerunFingerprint(hostDests, beforeAfterFiles, "up-to-date");

  if (options.action.type === "apply") {
    if ((await patch.getChains()).length > 0) {
      return { success: true, hasMoreWork: true };
    } else {
      await Dest.saveDigests(hostDests, { digest });
      return { success: true, hasMoreWork: false };
    }
  } else {
    await Dest.saveDigests(hostDests, { reset: "after-undo" });
    return { success: true, hasMoreWork: false };
  }
}

/**
 * A wrapper around main() to call it from a bin script.
 */
export function cli(): void {
  main(process.argv.slice(2))
    .then((success) => process.exit(success ? 0 : 1))
    .catch((e) => {
      printError(e);
      process.exit(1);
    });
}

if (require.main === module) {
  cli();
}
