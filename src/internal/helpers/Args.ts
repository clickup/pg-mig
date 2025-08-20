import minimist from "minimist";

export class Args<TStringArgs extends string, TFlagArgs extends string> {
  private args: minimist.ParsedArgs;

  constructor(argsIn: string[], strings: TStringArgs[], flags: TFlagArgs[]) {
    this.args = minimist(argsIn, {
      string: strings,
      boolean: flags,
      unknown: (arg) => {
        throw "Unknown argument: " + arg;
      },
    });
  }

  getOptional(name: TStringArgs): string | undefined {
    return this.args[name];
  }

  getFlag(name: TFlagArgs): boolean {
    return !!this.args[name];
  }

  get(name: TStringArgs, def?: string): string {
    const v = this.args[name] !== undefined ? this.args[name] : def;
    if (v === undefined) {
      throw `Parameter --${name} is missing`;
    }

    return v;
  }
}
