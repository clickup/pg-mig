import type { MigrateOptions } from "../cli";
import type { Registry } from "../internal/Registry";
import { printText } from "../internal/render";

/**
 * Prints the "code digest", of all migration version names on disk. Digest is a
 * string, and those strings can be compared lexicographically to determine
 * whether the code version is compatible with the DB version: if the DB's
 * digest is greater or equal to the code's digest, then they are compatible, so
 * the code can be deployed.
 */
export async function actionDigest(
  _options: MigrateOptions,
  registry: Registry,
): Promise<boolean> {
  printText(registry.getDigest());
  return true;
}
