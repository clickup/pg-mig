import { existsSync, lstatSync, readdirSync, readFileSync } from "fs";
import sortBy from "lodash/sortBy";
import { DefaultMap } from "./utils/DefaultMap";

/**
 * Migration file may have variables in it to tune behavior of the migration.
 * Format is: "-- $var_name=var_value" on any line of the file.
 */
const VALID_VARS = [
  // Introduces a delay (in ms) between each migration. Use with $parallelism_global to
  // reduce load on the db
  "$delay",
  // Limit parallelism of this particular version across all hosts.
  "$parallelism_global",
  // Limit parallelism of this particular version locally on each host.
  "$parallelism_per_host",
  // If set, no other migrations (including other versions) will run on any
  // other host while this one is running.
  "$run_alone",
] as const;

/**
 * One migration file (either *.up.* or *.dn.*).
 */
export interface File {
  fileName: string;
  parallelismPerHost: number;
  parallelismGlobal: number;
  delay: number;
  runAlone: boolean;
}

/**
 * A pair of up+dn files representing one migration.
 */
export interface Entry {
  up: File;
  dn: File;
  name: string;
  schemaPrefix: string;
}

/**
 * A directory with migration entries.
 * For every entry, an "up" and a "dn" files are required.
 */
export class Registry {
  private entriesByPrefix = new DefaultMap<string, Entry[]>();
  private versions = new Set<string>();
  public readonly beforeFile: File | null = null;
  public readonly afterFile: File | null = null;

  constructor(dir: string) {
    const files = readdirSync(dir)
      .sort()
      .filter((file) => lstatSync(dir + "/" + file).isFile());
    for (const file of files) {
      if (file === "before.sql") {
        this.beforeFile = buildFile(dir + "/" + file);
        continue;
      }

      if (file === "after.sql") {
        this.afterFile = buildFile(dir + "/" + file);
        continue;
      }

      const matches = file.match(/^((\d+\.[^.]+)\.([^.]+))\.(up|dn)\.sql$/);
      if (!matches) {
        throw (
          "Migration file must have format " +
          "NNNNNN.Title.SchemaPrefix.{up,dn}.sql, but found " +
          file
        );
      }

      if (matches[4] === "dn") {
        continue;
      }

      const entry: Entry = {
        up: buildFile(dir + "/" + file),
        dn: buildFile(dir + "/" + file.replace(/\.up\.(\w+)$/, ".dn.$1")),
        name: matches[1],
        schemaPrefix: matches[3],
      };

      this.entriesByPrefix.getOrAdd(entry.schemaPrefix, []).push(entry);
      this.versions.add(entry.name);
    }

    // Sort entries from longest schema prefix to shortest schema prefix.
    // This is needed later for duplicates removal (e.g. if some schema
    // name matches "sh0000" pattern, it shouldn't match "sh" pattern later).
    this.entriesByPrefix = new DefaultMap(
      sortBy(Array.from(this.entriesByPrefix), ([prefix]) => -prefix.length)
    );
  }

  get prefixes() {
    return Array.from(this.entriesByPrefix.keys());
  }

  getVersions() {
    return [...this.versions];
  }

  groupBySchema(schemas: string[]): ReadonlyMap<string, Entry[]> {
    const entriesBySchema = new Map<string, Entry[]>();
    for (const schema of schemas) {
      for (const [schemaPrefix, list] of this.entriesByPrefix.entries()) {
        if (!schema.startsWith(schemaPrefix)) {
          continue;
        }

        if (entriesBySchema.has(schema)) {
          const prevPrefix = entriesBySchema.get(schema)![0].schemaPrefix;
          if (prevPrefix.startsWith(schemaPrefix)) {
            // We've already matched this schema to a migration with some
            // longer prefix; e.g. if we have both migrations for "sh0000"
            // and "sh" prefixes, then the schema "sh0000" will match to
            // only the 1st one, and the 2nd one will be skipped.
            continue;
          }

          throw (
            "Schema " +
            schema +
            " matches more than one migration prefix (" +
            entriesBySchema.get(schema)![0].schemaPrefix +
            " and " +
            schemaPrefix +
            ")"
          );
        }

        entriesBySchema.set(schema, list);
      }
    }

    return entriesBySchema;
  }

  hasVersion(version: string) {
    return this.versions.has(version);
  }

  extractVersion(name: string) {
    const matches = name.match(/^\d+\.[^.]+\.[^.]+/);
    return matches ? matches[0] : name;
  }
}

function buildFile(fileName: string): File {
  const vars = extractVars(fileName);
  return {
    fileName,
    parallelismGlobal: vars.$parallelism_global || Number.POSITIVE_INFINITY,
    parallelismPerHost: vars.$parallelism_per_host || Number.POSITIVE_INFINITY,
    delay: vars.$delay || 0,
    runAlone: !!vars.$run_alone,
  };
}

function extractVars(fileName: string): {
  [k in typeof VALID_VARS[number]]?: number;
} {
  if (!existsSync(fileName)) {
    throw "Migration file doesn't exist: " + fileName;
  }

  const content = readFileSync(fileName).toString();

  const pairs: Array<[string, string]> = [];
  const regexIterator = /^--\s*(\$\w+)\s*=([^\r\n]+)[\r\n]*/my;
  while (regexIterator.exec(content)) {
    pairs.push([RegExp.$1, RegExp.$2]);
  }

  return Object.fromEntries(
    pairs.map(([k, v]) => {
      if (!VALID_VARS.includes(k as typeof VALID_VARS[number])) {
        throw "Unknown variable " + k + " in " + fileName;
      }

      return [k, parseInt(v.trim())];
    })
  );
}
