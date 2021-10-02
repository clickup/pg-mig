import { multirange } from "multi-integer-range";
import { DefaultMap } from "./DefaultMap";

export function collapse(list: string[]) {
  const res = [];
  const numberSuffixes = new DefaultMap<string, number[]>();
  for (const s of list.sort()) {
    const match = s.match(/^(.*?)(\d+)$/)!;
    if (match) {
      numberSuffixes.getOrAdd(match[1], []).push(parseInt(match[2]));
    } else {
      res.push(s);
    }
  }

  for (const [prefix, numbers] of numberSuffixes.entries()) {
    res.push(prefix + multirange(numbers).toString());
  }

  return res;
}
