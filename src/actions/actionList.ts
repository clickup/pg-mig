import sortBy from "lodash/sortBy";
import type { MigrateOptions } from "../cli";
import type { Registry } from "../internal/Registry";
import { printText } from "../internal/render";

/**
 * Prints the list of all migration versions in the registry.
 */
export async function actionList(
  _options: MigrateOptions,
  registry: Registry,
): Promise<boolean> {
  printText("All versions:");

  for (const version of sortBy(registry.getVersions())) {
    printText(` > ${version}`);
  }

  return true;
}
