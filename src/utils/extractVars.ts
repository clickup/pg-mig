/**
 * Migration file may have variables in it to tune behavior of the migration.
 * Format is: "-- $var_name=var_value" on any line of the file.
 */
const VALID_VARS = [
  // Introduces a delay (in ms) between each migration. Use with
  // $parallelism_global to reduce load on the db.
  "$delay",
  // Limit parallelism of this particular version across all hosts.
  "$parallelism_global",
  // Limit parallelism of this particular version locally on each host.
  "$parallelism_per_host",
  // If set, no other migrations (including other versions) will run on any
  // other host while this one is running.
  "$run_alone",
] as const;

export type Vars = {
  [k in typeof VALID_VARS[number]]?: number;
};

export function extractVars(fileName: string, content: string): Vars {
  const pairs: Array<[string, string]> = [];
  const regexIterator = /^--\s*(\$\w+)\s*=([^\r\n]+)[\r\n]*/gm;
  while (regexIterator.exec(content)) {
    pairs.push([RegExp.$1, RegExp.$2]);
  }

  return Object.fromEntries(
    pairs.map(([k, v]) => {
      if (!VALID_VARS.includes(k as typeof VALID_VARS[number])) {
        throw `Unknown variable ${k} in ${fileName}`;
      }

      return [k, parseInt(v.trim())];
    })
  );
}
