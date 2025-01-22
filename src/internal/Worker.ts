import { Semaphore } from "await-semaphore";
import type { Dest } from "./Dest";
import { promiseAllMap } from "./helpers/promiseAllMap";
import type { Chain, Migration } from "./Patch";

export interface MigrationError {
  dest: Dest;
  migration: Migration;
  error: any;
}

export class Worker {
  private _succeededMigrations: number = 0;
  private _errorMigrations: MigrationError[] = [];
  private _curDest: Dest | null = null;
  private _curMigration: Migration | null = null;
  private _curLine: string | null = null;

  constructor(
    private chainsQueue: Chain[],
    private semaphores: Record<string, Semaphore>,
  ) {}

  get succeededMigrations(): number {
    return this._succeededMigrations;
  }

  get errorMigrations(): readonly MigrationError[] {
    return this._errorMigrations;
  }

  get curDest(): Readonly<Dest> | null {
    return this._curDest;
  }

  get curMigration(): Readonly<Migration> | null {
    return this._curMigration;
  }

  get curLine(): string | null {
    return this._curLine;
  }

  async run(onChange: () => void): Promise<void> {
    while (this.chainsQueue.length > 0) {
      const chain = this.chainsQueue.shift()!;
      for (const migration of chain.migrations) {
        this._curDest = chain.dest;
        this._curMigration = migration;
        this._curLine = null;
        onChange();
        const interval = setInterval(() => onChange(), 200); // for long-running migrations
        try {
          await this.processMigration(chain.dest, migration);
          this._succeededMigrations++;
        } catch (error: unknown) {
          this._errorMigrations.push({
            dest: chain.dest,
            migration,
            error,
          });
          break;
        } finally {
          clearInterval(interval);
          onChange();
        }
      }
    }

    this._curDest = null;
    this._curMigration = null;
    this._curLine = null;
    onChange();
  }

  private async processMigration(
    dest: Dest,
    migration: Migration,
  ): Promise<void> {
    this._curLine = "waiting to satisfy parallelism limits...";
    const releases = await promiseAllMap(
      [
        this.acquireSemaphore(
          migration.file.runAlone ? 1 : Number.POSITIVE_INFINITY,
          "alone",
        ),
        this.acquireSemaphore(
          migration.file.parallelismGlobal,
          migration.version,
        ),
        this.acquireSemaphore(
          migration.file.parallelismPerHost,
          dest.host + ":" + migration.version,
        ),
      ],
      async (p) => p,
    );
    try {
      this._curLine = null;
      const res = await dest.runFile(
        migration.file.fileName,
        migration.newVersions,
        (proc) => {
          this._curLine = proc.lastOutLine;
        },
      );
      if (res.code) {
        throw res.out.trimEnd();
      }

      if (migration.file.delay > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, migration.file.delay),
        );
      }
    } finally {
      releases.forEach((release) => release());
    }
  }

  private async acquireSemaphore(
    maxWorkers: number,
    key: string,
  ): Promise<() => void> {
    let semaphore = this.semaphores[key];
    if (!semaphore) {
      semaphore = this.semaphores[key] = new Semaphore(maxWorkers);
    }

    return semaphore.acquire();
  }
}
