import { basename } from "path";
import compact from "lodash/compact";
import type { MigrateOptions } from "../cli";
import { Dest } from "../internal/Dest";
import { Grid } from "../internal/Grid";
import type { Chain } from "../internal/Patch";
import { Patch } from "../internal/Patch";
import {
  ProgressPrinterStream,
  ProgressPrinterTTY,
} from "../internal/ProgressPrinter";
import type { Registry } from "../internal/Registry";
import {
  printError,
  printSuccess,
  printText,
  renderGrid,
  renderLatestVersions,
  renderPatchSummary,
} from "../internal/render";

const MIN_TTY_ROWS = 5;

/**
 * Applies or undoes migrations.
 */
export async function actionUndoOrApply(
  options: MigrateOptions,
  hostDests: Dest[],
  registry: Registry,
): Promise<{ success: boolean; hasMoreWork: boolean }> {
  const digest = registry.getDigest();

  if (options.action.type === "apply" && options.createDB) {
    for (const dest of hostDests) {
      await dest
        .createDB((e) =>
          printText(
            `PostgreSQL host ${dest.getName()} is not yet up; waiting (${e})...`,
          ),
        )
        .then(
          (status) =>
            status === "created" &&
            printText(`Database ${dest.getName()} did not exist; created.`),
        );
    }
  }

  if (options.action.type === "undo" && !options.action.version) {
    printText(await renderLatestVersions(hostDests, registry));
    printError("Please provide a migration version to undo.");
    return { success: false, hasMoreWork: false };
  }

  const patch = new Patch(hostDests, registry, {
    undo: options.action.type === "undo" ? options.action.version : undefined,
  });
  const chains = await patch.getChains();

  // If we are going to undo something, reset the digest in the DB before
  // running the down migrations, so if we fail partially, the digest in the DB
  // will be reset.
  if (options.action.type === "undo" && chains.length > 0 && !options.dry) {
    await Dest.saveDigests(hostDests, { reset: "before-undo" });
  }

  const beforeAfterFiles = compact([
    registry.beforeFile?.fileName,
    registry.afterFile?.fileName,
  ]);

  if (
    chains.length === 0 &&
    (await Dest.checkRerunFingerprint(hostDests, beforeAfterFiles)) &&
    !options.force
  ) {
    // If we have nothing to apply, save the digest in case it was not saved
    // previously, to keep the invariant.
    if (options.action.type === "apply" && !options.dry) {
      await Dest.saveDigests(hostDests, { digest });
    }

    printText(await renderLatestVersions(hostDests, registry));
    printText(renderPatchSummary(chains, []));
    printSuccess("Nothing to do.");
    return { success: true, hasMoreWork: false };
  }

  if (options.dry) {
    printText(await renderLatestVersions(hostDests, registry));
    printText(renderPatchSummary(chains, beforeAfterFiles));
    printSuccess("Dry-run mode.");
    return { success: true, hasMoreWork: false };
  }

  printText(renderPatchSummary(chains, beforeAfterFiles));

  // Remember that if we crash below (e.g. in after.sql), we'll need to run
  // before.sql+after.sql on retry even if there are no new migration versions
  await Dest.saveRerunFingerprint(hostDests, beforeAfterFiles, "reset");

  const grid = new Grid(
    chains,
    options.parallelism ?? 10,
    registry.beforeFile
      ? hostDests.map<Chain>((dest) => ({
          type: "dn",
          dest,
          migrations: [
            {
              version: basename(registry.beforeFile!.fileName),
              file: registry.beforeFile!,
              newVersions: null,
            },
          ],
        }))
      : [],
    registry.afterFile
      ? hostDests.map<Chain>((dest) => ({
          type: "up",
          dest,
          migrations: [
            {
              version: basename(registry.afterFile!.fileName),
              file: registry.afterFile!,
              newVersions: null,
            },
          ],
        }))
      : [],
  );
  const progress =
    process.stdout.isTTY &&
    process.stdout.rows &&
    process.stdout.rows >= MIN_TTY_ROWS
      ? new ProgressPrinterTTY()
      : new ProgressPrinterStream();
  const success = await grid.run(
    progress.throttle(() =>
      progress.print(renderGrid(grid, progress.skipEmptyLines()).lines),
    ),
  );
  progress.clear();

  const { lines, errors, warnings } = renderGrid(grid, true);
  if (errors.length > 0) {
    printError("\n###\n### FAILED. See complete error list below.\n###\n");
    printText(lines.join("\n"));
    printError(`Failed with ${errors.length} error(s).`);
  } else if (warnings.length > 0) {
    printText(
      "\n###\n### SUCCEEDED with warnings. See complete warning list below.\n###\n",
    );
    printText(lines.join("\n"));
    printSuccess(`Succeeded with ${warnings.length} warning(s).`);
  } else {
    printSuccess("Succeeded.");
  }

  if (!success) {
    return { success: false, hasMoreWork: false };
  }

  await Dest.saveRerunFingerprint(hostDests, beforeAfterFiles, "up-to-date");

  if (options.action.type === "apply") {
    if ((await patch.getChains()).length > 0) {
      return { success: true, hasMoreWork: true };
    } else {
      await Dest.saveDigests(hostDests, { digest });
      return { success: true, hasMoreWork: false };
    }
  } else {
    await Dest.saveDigests(hostDests, { reset: "after-undo" });
    return { success: true, hasMoreWork: false };
  }
}
