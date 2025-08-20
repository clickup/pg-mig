import { RWLock } from "async-rwlock";
import { Semaphore } from "await-semaphore";
import type { Dest } from "./Dest";
import { promiseAllMap } from "./helpers/promiseAllMap";
import type { Chain, Migration } from "./Patch";

export interface MigrationOutput {
  dest: Dest;
  migration: Migration;
  payload: unknown;
}

const rwLock = new RWLock();

export class Worker {
  private succeededMigrations: number = 0;
  private errorMigrations: MigrationOutput[] = [];
  private warningMigrations: MigrationOutput[] = [];
  private curDest: Dest | null = null;
  private curMigration: Migration | null = null;
  private curLine: string | null = null;

  constructor(
    private chainsQueue: Chain[],
    private semaphores: Record<string, Semaphore>,
  ) {}

  getSucceededMigrations(): number {
    return this.succeededMigrations;
  }

  getErrorMigrations(): readonly MigrationOutput[] {
    return this.errorMigrations;
  }

  getWarningMigrations(): readonly MigrationOutput[] {
    return this.warningMigrations;
  }

  getCurDest(): Readonly<Dest> | null {
    return this.curDest;
  }

  getCurMigration(): Readonly<Migration> | null {
    return this.curMigration;
  }

  getCurLine(): string | null {
    return this.curLine;
  }

  async run(onChange: () => void): Promise<void> {
    while (this.chainsQueue.length > 0) {
      const chain = this.chainsQueue.shift()!;
      for (const migration of chain.migrations) {
        this.curDest = chain.dest;
        this.curMigration = migration;
        this.curLine = null;
        onChange();
        const interval = setInterval(() => onChange(), 200); // for long-running migrations
        try {
          const { warning } = await this.processMigration(
            chain.dest,
            migration,
          );
          this.succeededMigrations++;
          if (warning) {
            this.warningMigrations.push({
              dest: chain.dest,
              migration,
              payload: warning,
            });
          }
        } catch (error: unknown) {
          this.errorMigrations.push({
            dest: chain.dest,
            migration,
            payload: error,
          });
          break;
        } finally {
          clearInterval(interval);
          onChange();
        }
      }
    }

    this.curDest = null;
    this.curMigration = null;
    this.curLine = null;
    onChange();
  }

  private async processMigration(
    dest: Dest,
    migration: Migration,
  ): Promise<{ warning: string | null }> {
    this.curLine = "waiting to satisfy parallelism limits...";

    const releases = await promiseAllMap(
      [
        migration.file.runAlone
          ? rwLock.writeLock().then(() => rwLock.unlock.bind(rwLock))
          : rwLock.readLock().then(() => rwLock.unlock.bind(rwLock)),
        this.acquireSemaphore(
          migration.file.parallelismGlobal,
          migration.version,
        ),
        this.acquireSemaphore(
          migration.file.parallelismPerHost,
          dest.host + ":" + migration.version, // intentionally per host here, not per name()
        ),
      ],
      async (p) => p,
    );

    try {
      this.curLine = null;
      const res = await dest.runFile(
        migration.file.fileName,
        migration.newVersions,
        migration.file.vars,
        (proc) => {
          this.curLine = proc.getLastOutLine();
        },
      );
      if (res.getCode()) {
        throw res.getOut().trimEnd();
      }

      if (migration.file.delay > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, migration.file.delay),
        );
      }

      return { warning: res.getWarning() };
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
