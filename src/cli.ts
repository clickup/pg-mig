import { basename } from "path";
import sortBy from "lodash/sortBy";
import throttle from "lodash/throttle";
import logUpdate from "log-update";
import { Dest } from "./Dest";
import { Grid } from "./Grid";
import type { Chain } from "./Patch";
import { Patch } from "./Patch";
import { Registry } from "./Registry";
import {
  printError,
  printSuccess,
  printText,
  renderGrid,
  renderLatestVersions,
  renderPatchSummary,
} from "./render";
import { Args } from "./utils/Args";
import { makeMigration } from "./utils/makeMigration";

// Examples:
// yarn db:migrate --make=space_members_add_email@sh0000
// yarn db:migrate --undo 20191107201239.space_members.sh0000
// yarn db:migrate --undo 20191107201238.space_users_remove.sh

export async function main() {
  const args = new Args(
    process.argv,
    // Notice that we use --migdir and not --dir, because @mapbox/node-pre-gyp
    // used by bcrypt conflicts with --dir option.
    [
      "hosts",
      "port",
      "user",
      "pass",
      "db",
      "migdir",
      "parallelism",
      "undo",
      "make",
    ],
    ["dry", "ci", "list"],
  );
  return migrate({
    hosts: args
      .get("hosts", process.env.PGHOST || "localhost")
      .split(/[\s,;]+/),
    port: parseInt(args.get("port", process.env.PGPORT || "5432")),
    user: args.get("user", process.env.PGUSER || ""),
    pass: args.get("pass", process.env.PGPASSWORD || ""),
    db: args.get("db", process.env.PGDATABASE),
    undo: args.get("undo", "empty"),
    dry: args.flag("dry"),
    list: args.flag("list"),
    make: args.get("make", ""),
    migDir: args.get("migdir"),
    parallelism: parseInt(args.get("parallelism", "0")) || 10,
    ci: args.flag("ci"),
  });
}

export async function migrate(options: {
  hosts: string[];
  port: number;
  user: string;
  pass: string;
  db: string;
  undo: string;
  dry: boolean;
  list: boolean;
  make: string;
  migDir: string;
  parallelism: number;
  ci: boolean;
}) {
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

  if (options.make) {
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

  const patch = new Patch(hostDests, registry, {
    undo: options.undo !== "empty" ? options.undo : undefined,
  });
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
  const grid = new Grid(chains, options.parallelism, beforeChains, afterChains);

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
