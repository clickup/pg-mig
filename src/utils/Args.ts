import minimist from "minimist";

export class Args<TStringArgs extends string, TFlagArgs extends string> {
  private args: minimist.ParsedArgs;

  constructor(argv: string[], strings: TStringArgs[], flags: TFlagArgs[]) {
    this.args = minimist(argv.slice(2), {
      string: strings,
      boolean: flags,
      unknown: (arg) => {
        throw "Unknown argument: " + arg;
      },
    });
  }

  get(name: TStringArgs, def?: string): string {
    const v = this.args[name] !== undefined ? this.args[name] : def;
    if (v === undefined) {
      throw "Parameter " + name + " is missing";
    }

    return v;
  }

  flag(name: TFlagArgs) {
    return !!this.args[name];
  }
}
