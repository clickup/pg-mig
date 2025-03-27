import { basename, dirname } from "path";
import { setTimeout } from "timers/promises";
import { inspect } from "util";
import chunk from "lodash/chunk";
import compact from "lodash/compact";
import first from "lodash/first";
import { dedent } from "./helpers/dedent";
import { filesHash } from "./helpers/filesHash";
import { normalizeDsn } from "./helpers/normalizeDsn";
import { promiseAllMap } from "./helpers/promiseAllMap";
import { MIGRATION_VERSION_APPLIED, Psql } from "./Psql";

/**
 * A constant function in each schema that stores the list of migration versions
 * applied to that schema.
 */
const FUNC_VERSIONS = "mig_versions_const";

/**
 * A constant function in public schema that is updated with the migration
 * versions digest once ALL migrations are successfully applied to all schemas.
 * Can be used by some external caller to compare it with the result of
 * "--list=digest" invocation to check, whether the actual DB is in the same
 * state as the migration version files on disk (to e.g. make sure that the
 * deploying code is compatible with the database).
 */
const FUNC_DIGEST = "mig_digest_const";

/**
 * A constant function in public schema that returns a string to determine,
 * should we run before.sql+migrations+after.sql stage next time, even when
 * there are no migration versions pending. This may happen if e.g. after.sql
 * failed previously, and we need to rerun it on the next attempt. Or when the
 * list of schemas in the database changed externally (shards migration?), and
 * we need to rerun after.sql for some maintenance reasons.
 */
const FUNC_RERUN_FINGERPRINT = "mig_rerun_fingerprint_const";

/**
 * The default public schema which is active when connecting to a DB. Some
 * constant functions above are created in this schema, so the role that runs
 * the migration must have CREATE privilege on it.
 */
const DEFAULT_SCHEMA = "public";

/**
 * A destination database+schema to run the migrations against.
 */
export class Dest {
  private portIsSignificant = false;
  private dbIsSignificant = false;

  protected constructor(
    public readonly host: string,
    public readonly port: number,
    public readonly user: string,
    public readonly pass: string,
    public readonly db: string,
    public readonly schema = DEFAULT_SCHEMA,
  ) {}

  /**
   * Creates a Dest from a host name, host spec (host:port/db) or DSN URL.
   */
  static create(
    hostSpecOrDsn: string,
    defaults: {
      host?: string;
      port?: number;
      user?: string;
      pass?: string;
      db?: string;
      schema?: string;
    },
  ): Dest {
    const dsn = normalizeDsn(hostSpecOrDsn, {
      PGUSER: defaults.user,
      PGPASSWORD: defaults.pass,
      PGHOST: defaults.host,
      PGPORT: defaults.port?.toString(),
      PGDATABASE: defaults.db,
      PGSSLMODE: process.env["PGSSLMODE"],
    });
    if (!dsn) {
      throw "Host name or DSN is required.";
    }

    const url = new URL(dsn);
    return new Dest(
      url.hostname,
      parseInt(url.port) || 5432,
      url.username,
      url.password,
      url.pathname.slice(1),
    );
  }

  /**
   * Loads the digests from multiple databases using a custom SQL query runner.
   * The goal is to load at least one digest successfully from at least one
   * database. If we can't, then an error is thrown.
   */
  static async loadDigests<TDest>(
    dests: TDest[],
    sqlRunner: (
      dest: TDest,
      sql: string,
    ) => Promise<Array<Record<string, string>>>,
  ): Promise<string[]> {
    const errors: unknown[] = [];
    const digests = compact(
      await promiseAllMap(dests, async (dest) =>
        sqlRunner(
          dest,
          `SELECT digest FROM ${DEFAULT_SCHEMA}.${FUNC_DIGEST}() AS digest`,
        )
          .then((rows) => Object.values(rows[0] ?? {})[0] ?? null)
          .catch((e) => {
            errors.push(e);
            return null;
          }),
      ),
    );
    if (digests.length === 0) {
      throw new Error(
        `Each database out of ${dests.length} failed when loading the digest: ${inspect(errors)}`,
      );
    }

    return digests;
  }

  /**
   * Saves the digest to all Dests in the list in parallel. If some Dest fail,
   * it's not a big deal, since in the loading logic, we take care of partial
   * consensus situation.
   */
  static async saveDigests(
    dests: Dest[],
    value: { digest: string } | { reset: "before-undo" | "after-undo" },
  ): Promise<void> {
    await promiseAllMap(dests, async (dest) =>
      dest.saveDigest("digest" in value ? value.digest : value.reset),
    );
  }

  /**
   * Check that all dests rerun fingerprint match their expected values, so the
   * migration can be entirely skipped when there are no new migration versions.
   */
  static async checkRerunFingerprint(
    dests: Dest[],
    depFiles: string[],
  ): Promise<boolean> {
    const matches = await promiseAllMap(dests, async (dest) => {
      const fingerprint = await dest.loadRerunFingerprint();
      return fingerprint === ""
        ? false
        : fingerprint === (await dest.buildRerunFingerprint(depFiles));
    });
    return compact(matches).length === dests.length;
  }

  /**
   * Saves (or resets) rerun fingerprints on all dests.
   */
  static async saveRerunFingerprint(
    dests: Dest[],
    depFiles: string[],
    value: "up-to-date" | "reset",
  ): Promise<void> {
    await promiseAllMap(dests, async (dest) => {
      const fingerprint =
        value === "up-to-date"
          ? await dest.buildRerunFingerprint(depFiles)
          : "";
      await dest.saveRerunFingerprint(fingerprint);
    });
  }

  /**
   * When rendering the Dest name, we may sometimes omit the port or the db if
   * they are all the same across all of the Dests.
   */
  setSignificance({
    portIsSignificant,
    dbIsSignificant,
  }: {
    portIsSignificant: boolean;
    dbIsSignificant: boolean;
  }): this {
    this.portIsSignificant = portIsSignificant;
    this.dbIsSignificant = dbIsSignificant;
    return this;
  }

  /**
   * Returns a Dest switched to a different schema.
   */
  createSchemaDest(schema: string): Dest {
    return new Dest(
      this.host,
      this.port,
      this.user,
      this.pass,
      this.db,
      schema,
    ).setSignificance({
      portIsSignificant: this.portIsSignificant,
      dbIsSignificant: this.dbIsSignificant,
    });
  }

  /**
   * Returns a Dest switched to "no current database" mode (allows to e.g.
   * create databases).
   */
  createNoDBDest(): Dest {
    return new Dest(
      this.host,
      this.port,
      this.user,
      this.pass,
      "template1",
      undefined,
    ).setSignificance({
      portIsSignificant: this.portIsSignificant,
      dbIsSignificant: this.dbIsSignificant,
    });
  }

  /**
   * Returns a short human-readable representation of the Dest.
   */
  name(short?: "short"): string {
    return (
      (!short || this.host.match(/^\d+\.\d+\.\d+\.\d+$/)
        ? this.host
        : this.host.replace(/\..*/, "")) +
      (this.portIsSignificant ? `:${this.port}` : "") +
      (this.dbIsSignificant ? `/${this.db}` : "")
    );
  }

  /**
   * Returns a human-readable representation of the Dest with schema.
   */
  toString(): string {
    return this.name() + ":" + this.schema;
  }

  /**
   * Ensures that the DB exists. If the server can't be connected, retries until
   * it can be reachable (assuming this method is running in a dev or test
   * environment).
   */
  async createDB(
    onRetry: (e: string) => void,
  ): Promise<"already-exists" | "created"> {
    const noDBDest = this.createNoDBDest();
    while (true) {
      try {
        const res = await noDBDest.query(
          `SELECT datname FROM pg_database WHERE datname=${this.escape(this.db)}`,
        );
        if (first(res[0]) !== this.db) {
          await noDBDest.query(`CREATE DATABASE ${this.escapeIdent(this.db)}`);
          return "created";
        } else {
          return "already-exists";
        }
      } catch (e: unknown) {
        if (
          typeof e === "string" &&
          (e.includes("the database system is starting up") ||
            e.includes("could not connect to server") ||
            e.includes("error: connection to server"))
        ) {
          onRetry(e);
          await setTimeout(1000);
          continue;
        } else {
          throw e;
        }
      }
    }
  }

  /**
   * Runs a migration file for the current schema & DB.
   * If newVersions is passed, it's applied in the end of the transaction.
   */
  async runFile(
    fileName: string,
    newVersions: string[] | null,
    onOut?: (proc: Psql) => void,
  ): Promise<Psql> {
    const psql = new Psql(
      this,
      dirname(fileName),
      [],
      [
        // For some reason, -c... -f... -c... is not transactional, even with -1
        // flag; e.g. with -f... -c... when we press Ctrl+C, sometimes FUNC_NAME
        // is not created, although -f... file was committed. So we just
        // manually wrap everything with a transaction (not with -1).
        "BEGIN;",
        // We can't use SET LOCAL here, because migration files may contain
        // their own COMMIT statements (e.g. to create indexes concurrently),
        // and we want to remain the search_path set. Mid-COMMITs are not
        // compatible with PgBouncer in transaction pooling mode though.
        `SET search_path TO ${this.schema};`,
        "SET statement_timeout TO 0;",
        // Run the actual migration file.
        `\\i ${basename(fileName)}`,
        ";",
        `\\echo ${MIGRATION_VERSION_APPLIED}`,
        // Update schema version in the same transaction.
        newVersions
          ? `CREATE OR REPLACE FUNCTION ${this.schema}.${FUNC_VERSIONS}() RETURNS text ` +
            "LANGUAGE sql SET search_path FROM CURRENT AS " +
            `$$ SELECT ${this.escape(JSON.stringify(newVersions))}; $$;`
          : "",
        // In case PgBouncer in transaction pooling mode is used, we must
        // discard the effect of the migration for the connection. We can't use
        // DISCARD ALL since it can't be run inside a transaction (for some
        // unknown reason), so we manually run the queries DISCARD ALL would run
        // (see https://www.postgresql.org/docs/14/sql-discard.html).
        "CLOSE ALL;",
        "SET SESSION AUTHORIZATION DEFAULT;",
        "RESET ALL;",
        "DEALLOCATE ALL;",
        "UNLISTEN *;",
        "SELECT pg_advisory_unlock_all();",
        "DISCARD PLANS;",
        "DISCARD TEMP;",
        "DISCARD SEQUENCES;",
        // Commit both the migration and the version.
        "COMMIT;",
      ].join("\n"),
    );
    return psql.run(onOut);
  }

  /**
   * Returns all the shard-like schemas from the DB.
   */
  async loadSchemas(): Promise<string[]> {
    return this.queryCol(
      "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE '%\\_%' ORDER BY nspname",
    );
  }

  /**
   * Given a list of schemas, extracts versions for each schema (which is a list
   * of migration names).
   */
  async loadVersionsBySchema(
    schemas: string[],
  ): Promise<Map<string, string[]>> {
    if (!schemas.length) {
      return new Map();
    }

    const inClause = schemas.map((v) => this.escape(v)).join(", ");
    const schemasWithFunc = await this.query(`
      SELECT nspname FROM pg_proc
      JOIN pg_namespace ON pg_namespace.oid = pronamespace
      WHERE proname = ${this.escape(FUNC_VERSIONS)} AND nspname IN(${inClause})
    `);
    const selects = schemasWithFunc.map(
      ([schema]) =>
        `SELECT ${this.escape(schema)}, ${schema}.${FUNC_VERSIONS}()`,
    );
    const rows: string[][] = [];
    for (const list of chunk(selects, 1000)) {
      rows.push(...(await this.query(list.join(" UNION ALL "))));
    }

    const versionsBySchema = new Map(
      schemas.map((schema) => [schema, [] as string[]]),
    );
    for (const [schema, versionsStr] of rows) {
      versionsBySchema.set(schema, JSON.parse(versionsStr));
    }

    return versionsBySchema;
  }

  /**
   * Saves the given digest in a const function.
   */
  private async saveDigest(digest: string): Promise<void> {
    await this.query(`
      CREATE OR REPLACE FUNCTION ${DEFAULT_SCHEMA}.${FUNC_DIGEST}() RETURNS text
      LANGUAGE sql SET search_path FROM CURRENT AS
      $$ SELECT ${this.escape(digest)}; $$;
    `);
  }

  /**
   * Sets the "rerun fingerprint" for the Dest. Next time we run the migration,
   * and the fingerprint appear different (e.g. after.sql failed last time, or
   * the list of schemas in the database changed), then the full migration
   * sequence will run even if no new versions.
   */
  private async saveRerunFingerprint(fingerprint: string): Promise<void> {
    await this.query(`
      CREATE OR REPLACE FUNCTION ${DEFAULT_SCHEMA}.${FUNC_RERUN_FINGERPRINT}() RETURNS text
      LANGUAGE sql SET search_path FROM CURRENT AS
      $$ SELECT ${this.escape(fingerprint)}; $$;
    `);
  }

  /**
   * Loads the previously saved "rerun fingerprint".
   */
  private async loadRerunFingerprint(): Promise<string> {
    try {
      const res = await this.query(
        `SELECT ${DEFAULT_SCHEMA}.${FUNC_RERUN_FINGERPRINT}()`,
      );
      return first(res[0]) ?? "";
    } catch (e: unknown) {
      if (typeof e === "string" && e.includes("does not exist")) {
        return "";
      } else {
        throw e;
      }
    }
  }

  /**
   * Builds the current "rerun fingerprint" based on the database structure and
   * dependency files.
   */
  private async buildRerunFingerprint(depFiles: string[]): Promise<string> {
    const schemas = await this.loadSchemas();
    return [...schemas, `hash=${filesHash(depFiles)}`].join(",");
  }

  /**
   * SQL value quoting.
   */
  private escape(v: string): string {
    return "'" + ("" + v).replace(/'/g, "''") + "'";
  }

  /**
   * SQL identifier quoting.
   */
  private escapeIdent(ident: string): string {
    return ident.match(/^[a-z_][a-z_0-9]*$/is)
      ? ident
      : '"' + ident.replace(/"/g, '""') + '"';
  }

  /**
   * Queries a 2d table from the DB.
   */
  private async query(sql: string): Promise<string[][]> {
    const SEP = "\x01";
    const psql = new Psql(
      this,
      ".",
      [
        "-A", // unaligned output mode
        "-t", // print tuples only (no column names, no footer)
        `-F${SEP}`, // fields separator
      ],
      sql,
    );
    const { code, stdout, out } = await psql.run();
    if (code) {
      throw (
        `psql failed (${this.toString()})\n` +
        `${out.trimEnd()}\n` +
        `SQL: ${dedent(sql).trimEnd()}`
      );
    }

    return stdout
      .trimEnd()
      .split("\n")
      .filter((row) => row.length > 0)
      .map((row) => row.split(SEP));
  }

  /**
   * Same as query(), but queries just the 1st column.
   */
  private async queryCol(sql: string): Promise<string[]> {
    return (await this.query(sql)).map((v) => v[0]);
  }
}
