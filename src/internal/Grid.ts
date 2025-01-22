import groupBy from "lodash/groupBy";
import sum from "lodash/sum";
import { promiseAllMap } from "./helpers/promiseAllMap";
import type { Chain } from "./Patch";
import { Worker } from "./Worker";

/**
 * A fixed set of Workers running the migration chains.
 */
export class Grid {
  private _workers: Worker[] = [];
  private _totalMigrations: number = 0;
  private _startTime: number = 0;

  constructor(
    public readonly chains: Chain[],
    public readonly workersPerHost: number,
    public readonly beforeChains: Chain[] = [],
    public readonly afterChains: Chain[] = [],
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

    // "Before" sequence. Runs in parallel on all hosts (even on those that
    // don't have any new migration versions). If we fail, don't even start the
    // migrations.
    this._workers.push(
      ...this.beforeChains.map((chain) => new Worker([chain], {})),
    );
    await promiseAllMap(this._workers, async (worker) => worker.run(onChange));
    if (this.numErrors) {
      return false;
    }

    // Main migration. Create up to workersPerHost workers for each host; all
    // the workers will run in parallel and apply migration chains to various
    // shards until there is no more chains in the queue.
    const semaphores = {};
    const chainsByHost = groupBy(this.chains, (entry) => entry.dest.host);
    for (const chainsQueue of Object.values(chainsByHost)) {
      // For each one host, start as many workers as independent chains we have
      // in chainsQueue, but not more than this.workersPerHost. Each worker will
      // pick up jobs (chains) from the shared chainsQueue then.
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

    await promiseAllMap(this._workers, async (worker) => worker.run(onChange));

    // "After" sequence (we run it even on errors above). Runs on all hosts. We
    // don't clear this._workers here: we want to keep the history of errors.
    this._workers.push(
      ...this.afterChains.map((chain) => new Worker([chain], {})),
    );
    await promiseAllMap(this._workers, async (worker) => worker.run(onChange));
    if (this.numErrors) {
      return false;
    }

    // All done.
    return this.numErrors === 0;
  }
}
