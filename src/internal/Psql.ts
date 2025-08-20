import { spawn } from "child_process";
import { quote } from "shell-quote";
import type { Dest } from "./Dest";

/**
 * A tag which is expected to be echoed right after the migration file is
 * applied. This is for better output (an optional thing).
 */
export const MIGRATION_VERSION_APPLIED = "MIGRATION_VERSION_APPLIED";

/**
 * A wrapper for running psql.
 *
 * Keeps track on stdout/stderr (and both), also allows to trigger
 * and event if something is changed there, plus to read the last
 * line of the output.
 */
export class Psql {
  private args: string[];
  private code: number | null = null;
  private stdout: string = "";
  private stderr: string = "";
  private out: string = ""; // a mix of stdin and stdout
  private cmdline: string;

  constructor(
    private dest: Dest,
    private cwd: string,
    args: string[],
    private stdin: string,
  ) {
    this.args = [
      "-X", // do not read psqlrc
      "-vON_ERROR_STOP=1", // if it fails, then exit code will be nonzero
      ...args,
    ];
    this.cmdline = "psql " + quote(this.args);
  }

  getCode(): number | null {
    return this.code;
  }

  getStdout(): string {
    return this.stdout;
  }

  getStderr(): string {
    return this.stderr;
  }

  getWarning(): string | null {
    return this.stderr.match(/\bWARNING: {2}/m) ? this.stderr.trimEnd() : null;
  }

  getOut(): string {
    return this.out;
  }

  getCmdline(): string {
    return this.cmdline;
  }

  getLastOutLine(): string {
    const end = this.out.lastIndexOf(`\n${MIGRATION_VERSION_APPLIED}\n`);
    const out = end >= 0 ? this.out.substring(0, end + 1) : this.out;
    let posNewline1 = out.lastIndexOf("\n");
    let posNewline2 = out.length;
    // Find the 1st non-empty line scanning backward.
    while (posNewline1 >= 0 && posNewline1 + 1 === posNewline2) {
      posNewline2 = posNewline1;
      posNewline1 = out.lastIndexOf("\n", posNewline2 - 1);
    }

    return out.substring(posNewline1 + 1, posNewline2).trimEnd();
  }

  async run(onOut: (proc: this) => void = () => {}): Promise<this> {
    return new Promise((resolve) => {
      const proc = spawn("psql", this.args, {
        cwd: this.cwd,
        env: {
          ...process.env,
          PGHOST: this.dest.host,
          PGPORT: this.dest.port.toString(),
          PGUSER: this.dest.user,
          PGPASSWORD: this.dest.pass,
          PGDATABASE: this.dest.db,
          // Remove node_modules from PATH to force pg-mig use the "vanilla"
          // psql tool, even if the package manager overrides it. This is for
          // performance, and also, we are not meant to use a non-vanilla psql.
          PATH: (process.env["PATH"] ?? "")
            .split(":")
            .filter((p) => !p.includes("/node_modules/"))
            .join(":"),
        },
      });

      let clearSetInResponse = false;
      if (this.stdin) {
        clearSetInResponse = true;
        proc.stdin.write(this.stdin);
        proc.stdin.end();
      }

      proc.stdout.on("data", (data) => {
        let str = data.toString();
        if (clearSetInResponse) {
          str = str.replace(/^SET\r?\n/s, "");
          clearSetInResponse = false;
        }

        this.stdout += str;
        this.out += str;
        if (this.stdout !== "") {
          onOut(this);
        }
      });

      proc.stderr.on("data", (data) => {
        const str = data.toString();
        this.stderr += str;
        this.out += str;
        onOut(this);
      });

      proc.on("close", (code) => {
        this.code = code;
        resolve(this);
      });
    });
  }
}
