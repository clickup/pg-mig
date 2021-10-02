import { basename, dirname } from "path";
import chunk from "lodash/chunk";
import { Psql } from "./Psql";

const FUNC_NAME = "mig_versions_const";

/**
 * A destination database+schema to run the migrations against.
 */
export class Dest {
  constructor(
    public readonly host: string,
    public readonly user: string,
    public readonly pass: string,
    public readonly db: string,
    public readonly schema: string
  ) {}

  /**
   * Returns a Dest switched to a different schema.
   */
  createSchemaDest(schema: string) {
    return new Dest(this.host, this.user, this.pass, this.db, schema);
  }

  /**
   * Returns a human-readable representation of the dest.
   */
  toString() {
    return this.host + ":" + this.schema;
  }

  /**
   * Runs a migration file for the current schema & DB.
   * If newVersions is passed, it's applied in the end of the transaction.
   */
  async runFile(
    file: string,
    newVersions: string[] | null,
    onOut: (proc: Psql) => void = () => {}
  ) {
    const psql = new Psql(
      this,
      dirname(file),
      [],
      // For some reason, -c... -f... -c... is not transactional, even with -1 flag;
      // e.g. with -f... -c... when we press Ctrl+C, sometimes FUNC_NAME is not
      // created, although -f... file was committed. So we just manually wrap everything
      // with a transaction manually (not with -1).
      `BEGIN;\n` +
        `\\set ON_ERROR_STOP on\n` +
        `SET search_path TO ${this.schema};\n` +
        `\\i ${basename(file)}\n` +
        (newVersions
          ? `CREATE OR REPLACE FUNCTION ${this.schema}.${FUNC_NAME}() RETURNS text LANGUAGE sql AS $$` +
            `SELECT ${this.escape(JSON.stringify(newVersions))}; $$;\n`
          : "") +
        `COMMIT;\n`
    );
    return psql.run(onOut);
  }

  /**
   * Returns all the shard-like schemas from the DB.
   */
  async loadSchemas() {
    return this.queryCol(
      "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE '%\\_%'"
    );
  }

  /**
   * Given a list of schemas, extracts versions for each schema
   * (which is a list of migration names).
   */
  async loadVersionsBySchema(schemas: string[]) {
    if (!schemas.length) {
      return new Map<string, string[]>();
    }

    const inClause = schemas.map((v) => this.escape(v)).join(", ");
    const schemasWithFunc = await this.query(`
      SELECT nspname FROM pg_proc
      JOIN pg_namespace ON pg_namespace.oid = pronamespace
      WHERE proname = ${this.escape(FUNC_NAME)} AND nspname IN(${inClause})
    `);
    const selects = schemasWithFunc.map(
      ([schema]) => `SELECT ${this.escape(schema)}, ${schema}.${FUNC_NAME}()`
    );
    const rows: string[][] = [];
    for (const list of chunk(selects, 1000)) {
      rows.push(...(await this.query(list.join(" UNION ALL "))));
    }

    const versionsBySchema = new Map(
      schemas.map((schema) => [schema, [] as string[]])
    );
    for (const [schema, versionsStr] of rows) {
      versionsBySchema.set(schema, JSON.parse(versionsStr));
    }

    return versionsBySchema;
  }

  /**
   * SQL value quoting.
   */
  private escape(v: string) {
    return "'" + ("" + v).replace(/'/g, "''") + "'";
  }

  /**
   * Queries a 2d table from the DB.
   */
  private async query(sql: string): Promise<string[][]> {
    const SEP = "\x01";
    const psql = new Psql(this, ".", ["-At", "-F", SEP], sql);
    const { code, stdout, out } = await psql.run();
    if (code !== 0) {
      throw "psql failed (" + this.toString() + ")\n" + out;
    }

    return stdout
      .trimRight()
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
