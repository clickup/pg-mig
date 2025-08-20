import crypto from "crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "fs";
import { basename } from "path";
import partition from "lodash/partition";
import sortBy from "lodash/sortBy";
import { DefaultMap } from "./helpers/DefaultMap";
import type { Vars } from "./helpers/extractVars";
import { extractVars } from "./helpers/extractVars";
import { schemaNameMatchesPrefix } from "./helpers/schemaNameMatchesPrefix";
import { wrapNonTransactional } from "./helpers/wrapNonTransactional";

// Must be lexicographically less than "0".
const DIGEST_SEP = ".";

/**
 * One migration file (either *.up.* or *.dn.*).
 */
export interface File {
  fileName: string;
  parallelismPerHost: number;
  parallelismGlobal: number;
  delay: number;
  runAlone: boolean;
  vars: Vars;
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

  constructor(public readonly dir: string) {
    const files = readdirSync(dir)
      .sort()
      .filter((file) => lstatSync(dir + "/" + file).isFile());
    for (const file of files) {
      if (!file.endsWith(".sql")) {
        continue;
      }

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
      sortBy(Array.from(this.entriesByPrefix), ([prefix]) => -prefix.length),
    );
  }

  static chooseBestDigest(values: string[]): string {
    const [digests, resets] = partition(values, (digest) =>
      digest.includes(DIGEST_SEP),
    );

    // If we have at least one real digest, then use the highest one. It means
    // that the database is at least at that migration, since we save all
    // digests after successful migration process, when it succeeds everywhere.
    if (digests.length > 0) {
      return sortBy(digests).reverse()[0];
    }

    // If no real digests are provided, then someone initiated an undo. We
    // proceed with DB migration process only when we're sure that we saved undo
    // signal to ALL databases, so we can be sure that, even if undo fails, ALL
    // DBs will have that reset digest saved in.
    if (resets.length > 0) {
      return "0" + DIGEST_SEP + sortBy(resets)[0];
    }

    // No digests at all passed to the function.
    return "0";
  }

  getPrefixes(): string[] {
    return [...this.entriesByPrefix.keys()];
  }

  groupBySchema(schemas: string[]): ReadonlyMap<string, Entry[]> {
    const entriesBySchema = new Map<string, Entry[]>();
    for (const schema of schemas) {
      for (const [schemaPrefix, list] of this.entriesByPrefix.entries()) {
        if (!schemaNameMatchesPrefix(schema, schemaPrefix)) {
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
            `Schema ${schema} matches more than one migration prefix ` +
            `(${prevPrefix} and ${schemaPrefix})`
          );
        }

        entriesBySchema.set(schema, list);
      }
    }

    return entriesBySchema;
  }

  getVersions(): string[] {
    return sortBy([...this.versions]);
  }

  hasVersion(version: string): boolean {
    return this.versions.has(version);
  }

  extractVersion(name: string): string {
    const matches = name.match(/^\d+\.[^.]+\.[^.]+/);
    return matches ? matches[0] : name;
  }

  getDigest(type?: "short"): string {
    const versions = this.getVersions();
    const lastOrder = versions[versions.length - 1]?.match(/^(\d+)/)
      ? RegExp.$1
      : versions.length > 0
        ? versions[versions.length - 1]
        : "0";
    const hash = crypto
      .createHash("sha256")
      .update(versions.join("\n"))
      .digest("hex");
    return (
      lastOrder + DIGEST_SEP + (type === "short" ? hash.slice(0, 16) : hash)
    );
  }
}

function buildFile(fileName: string): File {
  if (!existsSync(fileName)) {
    throw `Migration file doesn't exist: ${fileName}`;
  }

  const content = readFileSync(fileName).toString();
  const vars = extractVars(fileName, content);

  const file: File = {
    fileName,
    parallelismGlobal: vars.$parallelism_global || Number.POSITIVE_INFINITY,
    parallelismPerHost: vars.$parallelism_per_host || Number.POSITIVE_INFINITY,
    delay: vars.$delay || 0,
    runAlone: !!vars.$run_alone,
    vars,
  };

  const { errors } = wrapNonTransactional(fileName, vars);
  if (errors.length > 0) {
    throw (
      `File ${basename(fileName)} must satisfy the following:\n` +
      errors.map((e) => `  - ${e}`).join("\n")
    );
  }

  return file;
}
