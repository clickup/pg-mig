import { existsSync } from "fs";
import { dirname } from "path";
import omitBy from "lodash/omitBy";

/**
 * Reads the config files from parent directories and return them from the most
 * parent'ish to the most child'ish.
 *
 * A config is a code file which may:
 * 1. Export an object.
 * 2. Export a function (sync or async) which returns an object.
 */
export async function readConfigs(
  fileName: string,
  ...args: unknown[]
): Promise<object[]> {
  const configs: object[] = [];
  for (let dir = process.cwd(); dirname(dir) !== dir; dir = dirname(dir)) {
    const path = `${dir}/${fileName}`;
    let loaded: { default?: unknown } | undefined;

    const pathJS = `${path}.js`;
    if (existsSync(pathJS)) {
      loaded = require(pathJS);
    }

    const pathTS = `${path}.ts`;
    if (existsSync(pathTS)) {
      try {
        // eslint-disable-next-line import/no-extraneous-dependencies
        require("ts-node/register");
      } catch (e: unknown) {
        throw (
          `${(e instanceof Error ? e.stack ?? e.message : "" + e).trim()}\n` +
          `Cause:\n    To load ${pathTS}, please install ts-node module.`
        );
      }

      loaded = require(pathTS);
    }

    if (!loaded) {
      continue;
    }

    let config =
      loaded instanceof Function
        ? loaded(...args)
        : loaded.default instanceof Function
          ? loaded.default(...args)
          : loaded.default
            ? loaded.default
            : loaded;
    config = config instanceof Promise ? await config : config;
    config = omitBy(config, (v) => v === undefined);
    configs.push(config);
  }

  return configs.reverse();
}
