import { multirange } from "multi-integer-range";
import { DefaultMap } from "./DefaultMap";

export function collapse(list: string[]): string[] {
  const res = [];
  const numberSuffixes = new DefaultMap<
    string,
    { numbers: number[]; widths: Map<number, number> }
  >();
  for (const s of list.sort()) {
    const match = s.match(/^(.*?)(\d+)$/)!;
    if (match) {
      const prefix = match[1];
      const numStr = match[2];
      const n = parseInt(numStr);
      const slot = numberSuffixes.getOrAdd(prefix, {
        numbers: [],
        widths: new Map(),
      });
      slot.numbers.push(n);
      slot.widths.set(n, numStr.length);
    } else {
      res.push(s);
    }
  }

  for (const [prefix, { numbers, widths }] of numberSuffixes.entries()) {
    res.push(
      prefix +
        multirange(numbers)
          .toString()
          .replace(/(\d+)/g, (_, n: string) =>
            n.padStart(widths.get(parseInt(n)) ?? 0, "0"),
          ),
    );
  }

  return res;
}
