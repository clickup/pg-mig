/**
 * Accepts DSN in various formats and returns its URL-normalized version, or
 * throws in case some essential part of the DSN is missing. Tries to use PG*
 * environment variables for the missing parts.
 */
export function normalizeDsn(
  dsnOrIslandNo: string | undefined,
  env:
    | {
        PGUSER: string | undefined;
        PGPASSWORD: string | undefined;
        PGHOST: string | undefined;
        PGPORT: string | undefined;
        PGDATABASE: string | undefined;
        PGSSLMODE: string | undefined;
      }
    | Record<string, string | undefined> = process.env,
  islandDsns?: string[],
): string | undefined {
  if (!dsnOrIslandNo) {
    return undefined;
  }

  if (islandDsns && dsnOrIslandNo.match(/^\d+$/)) {
    return normalizeDsn(islandDsns[parseInt(dsnOrIslandNo, 10)], env);
  }

  const errorPrefix = `Error parsing "${dsnOrIslandNo}"`;

  let url: URL;
  const match = dsnOrIslandNo.match(/^\w+:\/\/(.*)$/);
  if (match) {
    // URL class doesn't support username/password fields for custom protocols
    // like "postgresql", so we pretend it's https.
    if (!match[1]) {
      // Allow passing dsn="https://" for all-env defaults.
      url = new URL(`https://${env["PGHOST"]}`);
    } else {
      url = new URL(`https://${match[1]}`);
    }
  } else {
    const parsed = parseDbHostSpec(dsnOrIslandNo);
    parsed.host ||= env["PGHOST"] || "";
    if (!parsed.host) {
      throw `${errorPrefix}: host is missing (pass it or set PGHOST environment variable)`;
    }

    url = new URL(`https://${parsed.host}`);
    url.port = parsed.port ? String(parsed.port) : "";
    url.pathname = parsed.database ? `/${parsed.database}` : "";
  }

  url.username ||= env["PGUSER"] ?? "";
  url.password ||= env["PGPASSWORD"] ?? "";
  url.port ||= env["PGPORT"] ?? "";

  if (url.pathname === "/") {
    url.pathname = "/" + (env["PGDATABASE"] ?? "");
  }

  if (env.PGSSLMODE) {
    const params = new URLSearchParams(url.search);
    params.set("sslmode", env.PGSSLMODE);
    url.search = params.toString();
  }

  if (!url.username) {
    throw `${errorPrefix}: username is missing (pass it or set PGUSER environment variable)`;
  } else if (!url.password) {
    throw `${errorPrefix}: password is missing (pass it or set PGPASSWORD environment variable)`;
  } else if (!url.hostname) {
    throw `${errorPrefix}: host is missing (pass it or set PGHOST environment variable)`;
  } else if (!url.pathname || url.pathname === "/") {
    throw `${errorPrefix}: database name is missing (pass it or set PGDATABASE environment variable)`;
  }

  return url.toString().replace(/^\w+:\/\//, "postgresql://");
}

/**
 * Parses "host[:port][/database]" string.
 */
function parseDbHostSpec(hostSpec: string): {
  host: string;
  port?: number;
  database?: string;
} {
  const { host, port, database } = hostSpec.match(
    /^(?<host>.*?)(?::(?<port>\d+))?(?:\/(?<database>.+))?$/s,
  )!.groups!;
  return {
    host,
    port: port ? parseInt(port) : undefined,
    database: database || undefined,
  };
}
