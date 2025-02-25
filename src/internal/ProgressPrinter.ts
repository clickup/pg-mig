import throttle from "lodash/throttle";
import logUpdate from "log-update";
import { printText } from "./render";

export interface ProgressPrinter {
  throttle(render: () => void): () => void;
  print(text: string[]): void;
  clear(): void;
  skipEmptyLines(): boolean;
}

export class ProgressPrinterTTY implements ProgressPrinter {
  private logUpdate = logUpdate.create(process.stdout, {
    showCursor: true,
  });

  throttle(render: () => void): () => void {
    return throttle(render, 100, { trailing: false });
  }

  print(rows: string[]): void {
    if (rows.length > 0) {
      this.logUpdate(
        rows.slice(0, Math.max((process.stdout.rows || 25) - 3, 3)).join("\n"),
      );
    } else {
      this.logUpdate.clear();
    }
  }

  clear(): void {
    this.logUpdate.clear();
  }

  skipEmptyLines(): boolean {
    return false;
  }
}

export class ProgressPrinterStream implements ProgressPrinter {
  private printedNormalized = new Set<string>();

  throttle(render: () => void): () => void {
    return render;
  }

  print(rows: string[]): void {
    for (const line of rows) {
      const normalized = line.replace(/^(\w+:.*) elapsed.*/s, "$1");
      if (this.printedNormalized.has(normalized)) {
        continue;
      }

      printText(line);
      this.printedNormalized.add(normalized);
    }
  }

  clear(): void {
    this.printedNormalized.clear();
  }

  skipEmptyLines(): boolean {
    return true;
  }
}
