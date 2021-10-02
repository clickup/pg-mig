import { spawn } from "child_process";
import { quote } from "shell-quote";
import { Dest } from "./Dest";

/**
 * A wrapper for running psql.
 *
 * Keeps track on stdout/stderr (and both), also allows to trigger
 * and event if something is changed there, plus to read the last
 * line of the output.
 */
export class Psql {
  private _args: string[];
  private _code: number | undefined = undefined;
  private _stdout: string = "";
  private _stderr: string = "";
  private _out: string = "";
  private _cmdline: string;

  constructor(
    private dest: Dest,
    private cwd: string,
    args: string[],
    private stdin?: string
  ) {
    this._args = ["-X", ...args];
    this._cmdline = "psql " + quote(this._args);
  }

  get code() {
    return this._code;
  }

  get stdout() {
    return this._stdout;
  }

  get stderr() {
    return this._stderr;
  }

  get out() {
    return this._out;
  }

  get cmdline() {
    return this._cmdline;
  }

  get lastOutLine() {
    let pos = this._out.lastIndexOf("\n");
    let end = this._out.length;
    // Find the 1st non-empty line scanning backward.
    while (pos >= 0 && pos === end - 1) {
      end = pos;
      pos = this._out.lastIndexOf("\n", end - 1);
    }

    const line = this._out.substring(pos + 1, end).trimRight();
    return line;
  }

  async run(onOut: (proc: this) => void = () => {}): Promise<this> {
    return new Promise((resolve) => {
      const proc = spawn("psql", this._args, {
        cwd: this.cwd,
        env: {
          ...process.env,
          PGHOST: this.dest.host,
          PGUSER: this.dest.user,
          PGPASSWORD: this.dest.pass,
          PGDATABASE: this.dest.db,
          PATH: process.env.PATH,
        },
      });
      if (this.stdin) {
        proc.stdin.write(this.stdin);
        proc.stdin.end();
      }

      proc.stdout.on("data", (data) => {
        const str = data.toString();
        this._stdout += str;
        this._out += str;
        onOut(this);
      });
      proc.stderr.on("data", (data) => {
        const str = data.toString();
        this._stderr += str;
        this._out += str;
        onOut(this);
      });
      proc.on("close", (code) => {
        this._code = code;
        resolve(this);
      });
    });
  }
}
