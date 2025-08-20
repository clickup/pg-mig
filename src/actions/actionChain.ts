import { writeFileSync } from "fs";
import type { MigrateOptions } from "../cli";
import { unindent } from "../internal/helpers/unindent";
import type { Registry } from "../internal/Registry";

const WARNING =
  "IF THERE IS MERGE CONFLICT HERE, DO NOT RESOLVE IT MANUALLY! READ ABOVE!";

/**
 * Overwrites the chain file for the migration versions. Chain file ensures that
 * the migration versions are appended strictly in the end (so a migration file
 * appeared in the middle will produce a git merge conflict).
 */
export async function actionChain(
  options: MigrateOptions,
  registry: Registry,
): Promise<boolean> {
  const lines: string[] = [];
  lines.push(
    unindent(`
      #
      # If you pulled, and a merge conflict occurs in this file, it means the
      # migration version file that you recently created appears in the middle
      # of already-applied migrations, instead of at the end.
      #
      # Migration versions MUST form a strict "blockchain-like" list, where
      # new versions are ALWAYS appended in the end ("append-only" principle).
      #
      # DO NOT resolve this Git merge conflict manually!!!
      #
      # Instead, do the following:
      #
      # 1. First, make sure the current file matches the upstream version
      #    (equivalent to "accept theirs" in Git conflict resolution).
      # 2. UNDO your migration version that you created recently.
      # 3. Rename your migration version file so that its timestamp becomes the
      #    highest (i.e. the latest) among all migrations.
      # 4. Regenerate the chain file with: pg-mig --chain
      # 5. APPLY your migration version locally with: pg-mig
      # 6. Resubmit the Pull Request. It will not have any merge conflicts
      #    anymore, because your migration version file is now in the end.
      #
    `),
  );
  lines.push("");
  lines.push(`digest=${registry.getDigest("short")}  # ${WARNING}`);
  lines.push("");

  let prevVersion = "(init)";
  for (const version of registry.getVersions()) {
    lines.push(`${prevVersion} -> ${version}  # ${WARNING}`);
    prevVersion = version;
  }

  writeFileSync(`${options.migDir}/chain.txt`, lines.join("\n") + "\n", {
    mode: 0o644,
  });

  return true;
}
