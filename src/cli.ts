#!/usr/bin/env node
import compact from "lodash/compact";
import mapValues from "lodash/mapValues";
import pickBy from "lodash/pickBy";
import { actionChain } from "./actions/actionChain";
import { actionDigest } from "./actions/actionDigest";
import { actionList } from "./actions/actionList";
import { actionMake } from "./actions/actionMake";
import { actionUndoOrApply } from "./actions/actionUndoOrApply";
import { Dest } from "./internal/Dest";
import { Args } from "./internal/helpers/Args";
import { readConfigs } from "./internal/helpers/readConfigs";

import { Registry } from "./internal/Registry";
import { printError, printText } from "./internal/render";

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
    | { type: "chain" }
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
      "chain",
      "list",
      "parallelism",
    ],
    ["dry", "createdb", "force", "skip-config"],
  );

  const action: MigrateOptions["action"] =
    args.getOptional("make") !== undefined
      ? { type: "make", name: args.get("make") }
      : args.getOptional("chain") !== undefined
        ? { type: "chain" }
        : args.getOptional("list") === ""
          ? { type: "list" }
          : args.getOptional("list") === "digest"
            ? { type: "digest" }
            : args.getOptional("undo") !== undefined
              ? { type: "undo", version: args.get("undo") }
              : { type: "apply", after: [] };

  if (!args.getFlag("skip-config")) {
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
      args.getFlag("createdb") ||
      ![undefined, null, "", "0", "false", "undefined", "null", "no"].includes(
        process.env["PGCREATEDB"],
      ),
    parallelism: parseInt(args.get("parallelism", "0")) || undefined,
    dry: args.getFlag("dry"),
    force: args.getFlag("force"),
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
    .map((dest) => dest.getHostSpec())
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
      "Running on " + hostDests.map((dest) => dest.getName()).join(","),
      !portIsSignificant && `port ${hostDests[0].port}`,
      !dbIsSignificant && `db ${hostDests[0].db}`,
    ]).join(", "),
  );

  if (options.action.type === "make") {
    return actionMake(options, registry, options.action.name);
  }

  if (options.action.type === "chain") {
    return actionChain(options, registry);
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
