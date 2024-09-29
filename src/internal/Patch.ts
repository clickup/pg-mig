import flatten from "lodash/flatten";
import sortBy from "lodash/sortBy";
import type { Dest } from "./Dest";
import type { Entry, File, Registry } from "./Registry";

interface Mode {
  undo: string | undefined;
}

/**
 * A migration to apply to some Dest.
 */
export interface Migration {
  version: string;
  file: File;
  newVersions: string[] | null;
}

/**
 * A sequence of migrations to apply one by one and ASAP to a
 * particular Dest (i.e. on a particular schema or shard).
 */
export interface Chain {
  type: "up" | "dn";
  dest: Dest;
  migrations: Migration[];
}

/**
 * A set of chains to apply to the database.
 */
export class Patch {
  constructor(
    private hosts: Dest[],
    private registry: Registry,
    private mode: Mode,
  ) {}

  async getChains(): Promise<Chain[]> {
    // The algorithm is not perfect: we treat schemas independently, so even if
    // e.g. a migration for schema=public precedes a migration for some other
    // schema=sh1234 in the repository, there is a chance that sh1234 will be
    // processed earlier than public. It's a trade-off to not implement a much
    // more complicated algorithm with explicit cross-schema dependencies.
    if (this.mode.undo) {
      const undoVersion = this.registry.extractVersion(this.mode.undo);
      if (!this.registry.hasVersion(undoVersion)) {
        throw `No such version on disk: ${undoVersion} (in ${this.registry.dir})`;
      }
    }

    const chains = await Promise["all"](
      this.hosts.map(async (hostDest) => this.getHostChains(hostDest)),
    );
    return flatten(chains);
  }

  private async getHostChains(hostDest: Dest): Promise<Chain[]> {
    const allSchemas = await hostDest.loadSchemas();
    const reEntries = this.registry.groupBySchema(allSchemas);
    const schemas = Array.from(reEntries.keys());
    const dbVersions = await hostDest.loadVersionsBySchema(schemas);
    const chains = schemas.map((schema) =>
      this.getSchemaChain(
        hostDest.createSchemaDest(schema),
        dbVersions.get(schema)!,
        reEntries.get(schema)!,
      ),
    );
    return sortBy(
      chains.filter((chain) => chain && chain.migrations.length > 0) as Chain[],
      (chain) => chain.dest.host,
      (chain) => chain.dest.db,
      (chain) => chain.dest.schema,
    );
  }

  private getSchemaChain(
    dest: Dest,
    dbVersions: string[],
    reEntries: Entry[],
  ): Chain | null {
    try {
      if (!this.mode.undo) {
        return this.getChainUp(dest, dbVersions, reEntries);
      } else {
        return this.getChainDn(dest, dbVersions, reEntries, this.mode.undo);
      }
    } catch (e: any) {
      throw typeof e === "string" ? dest.toString() + ": " + e : e;
    }
  }

  private getChainUp(
    dest: Dest,
    dbVersions: string[],
    reEntries: Entry[],
  ): Chain {
    for (let i = 0; i < reEntries.length; i++) {
      if (i >= dbVersions.length) {
        // db:   a b c d e
        // dir:  a b c d e F G
        //                 ^i
        const entriesToApply = reEntries.slice(i);
        return {
          type: "up",
          dest,
          // F: a b c d e F
          // G: a b c d e F G
          migrations: entriesToApply.map((entry, pos) => ({
            version: entry.name,
            file: entry.up,
            newVersions: [
              ...dbVersions,
              ...entriesToApply.slice(0, pos + 1).map((ver) => ver.name),
            ],
          })),
        };
      } else if (dbVersions[i] !== reEntries[i].name) {
        throw (
          "Migration timeline violation: you're asking to apply version " +
          reEntries[i].name +
          ", although version " +
          dbVersions[i] +
          " has already been applied. Hint: make sure that you've rebased on top of the main branch, and new migration versions are still the most recent."
        );
      }
    }

    if (dbVersions.length > reEntries.length) {
      throw (
        "Version " +
        dbVersions[reEntries.length] +
        " exists in the DB, but is missing on disk. Hint: make sure you've rebased on top of the main branch."
      );
    }

    return { type: "up", dest, migrations: [] };
  }

  private getChainDn(
    dest: Dest,
    dbVersions: string[],
    reEntries: Entry[],
    undoVersion: string,
  ): Chain | null {
    undoVersion = this.registry.extractVersion(undoVersion);
    if (dbVersions[dbVersions.length - 1] === undoVersion) {
      // Undo the exactly latest version.
      // db:   a b c d e
      // undo:         e
      const undoEntry = reEntries.find((entry) => entry.name === undoVersion);
      if (!undoEntry) {
        throw `No such version on disk: ${undoVersion} (in ${this.registry.dir})`;
      }

      return {
        type: "dn",
        dest,
        migrations: [
          {
            version: undoVersion,
            file: undoEntry.dn,
            newVersions: dbVersions.slice(0, -1),
          },
        ],
      };
    }

    const pos = dbVersions.indexOf(undoVersion);
    if (pos >= 0) {
      // Can't undo in the middle.
      // db:   a b c d e
      // undo:     c
      throw (
        "We can undo to only the latest version, and there are versions in the DB after " +
        undoVersion +
        ": " +
        dbVersions.slice(pos + 1).join(", ")
      );
    }

    // Just skip, undoVersion was never applied to the dest.
    // db:   a b c d e
    // undo:           f
    return null;
  }
}
