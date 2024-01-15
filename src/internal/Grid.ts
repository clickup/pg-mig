import { Semaphore } from "await-semaphore";
import groupBy from "lodash/groupBy";
import sum from "lodash/sum";
import type { Dest } from "./Dest";
import type { Chain, Migration } from "./Patch";

/**
 * A fixed set of Workers running the migration chains.
 */
export class Grid {
  private _workers: Worker[] = [];
  private _totalMigrations: number = 0;
  private _startTime: number = 0;

  constructor(
    private chains: Chain[],
    private workersPerHost: number,
    private beforeChains: Chain[] = [],
    private afterChains: Chain[] = [],
  ) {}

  get workers(): readonly Worker[] {
    return this._workers;
  }

  get totalMigrations(): number {
    return this._totalMigrations;
  }

  get processedMigrations(): number {
    let num = 0;
    for (const worker of this.workers) {
      num += worker.succeededMigrations + worker.errorMigrations.length;
    }

    return num;
  }

  get elapsedSeconds(): number {
    return (Date.now() - this._startTime) / 1000;
  }

  get numErrors(): number {
    let num = 0;
    for (const worker of this._workers) {
      if (worker.errorMigrations.length > 0) {
        num++;
      }
    }

    return num;
  }

  async run(onChange: () => void = () => {}): Promise<boolean> {
    this._startTime = Date.now();

    // "Before" sequence. Runs in parallel on all hosts; if we fail, don't even
    // start the migrations.
    for (const chain of this.beforeChains) {
      this._workers.push(new Worker([chain], {}));
    }

    await Promise["all"](
      this._workers.map(async (worker) => worker.run(onChange)),
    );
    if (this.numErrors) {
      return false;
    }

    // Main migration. Create up to workersPerHost workers for each host; all
    // the workers will run in parallel and apply migration chains to various
    // shards until there is no more chains in the queue.
    const semaphores = {};
    const chainsByHost = groupBy(this.chains, (entry) => entry.dest.host);
    for (const chainsQueue of Object.values(chainsByHost)) {
      for (
        let i = 0;
        i < Math.min(chainsQueue.length, this.workersPerHost);
        i++
      ) {
        this._workers.push(new Worker(chainsQueue, semaphores));
      }

      this._totalMigrations += sum(
        chainsQueue.map((entry) => entry.migrations.length),
      );
    }

    await Promise["all"](
      this._workers.map(async (worker) => worker.run(onChange)),
    );

    // "After" sequence (we run it even on errors above). We don't clear
    // this._workers here, because we want to keep the history of errors.
    for (const chain of this.afterChains) {
      this._workers.push(new Worker([chain], {}));
    }

    await Promise["all"](
      this._workers.map(async (worker) => worker.run(onChange)),
    );
    if (this.numErrors) {
      return false;
    }

    // All done.
    return this.numErrors === 0;
  }
}

class Worker {
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
          this._curMigration = null;
          this._curDest = null;
          clearInterval(interval);
        }
      }

      this._curLine = null;
    }

    onChange();
  }

  private async processMigration(
    dest: Dest,
    migration: Migration,
  ): Promise<void> {
    this._curLine = "waiting to satisfy parallelism limits...";
    const releases = await Promise["all"]([
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
    ]);
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

interface MigrationError {
  dest: Dest;
  migration: Migration;
  error: any;
}
