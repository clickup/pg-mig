import groupBy from "lodash/groupBy";
import sum from "lodash/sum";
import { promiseAllMap } from "./helpers/promiseAllMap";
import type { Chain } from "./Patch";
import { Worker } from "./Worker";

/**
 * A fixed set of Workers running the migration chains.
 */
export class Grid {
  private workers: Worker[] = [];
  private totalMigrations: number = 0;
  private startTime: number = 0;

  constructor(
    public readonly chains: Chain[],
    public readonly workersPerHost: number,
    public readonly beforeChains: Chain[] = [],
    public readonly afterChains: Chain[] = [],
  ) {}

  getWorkers(): readonly Worker[] {
    return this.workers;
  }

  getTotalMigrations(): number {
    return this.totalMigrations;
  }

  getProcessedMigrations(): number {
    let num = 0;
    for (const worker of this.workers) {
      num +=
        worker.getSucceededMigrations() + worker.getErrorMigrations().length;
    }

    return num;
  }

  getElapsedSeconds(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  getNumErrors(): number {
    let num = 0;
    for (const worker of this.workers) {
      if (worker.getErrorMigrations().length > 0) {
        num++;
      }
    }

    return num;
  }

  async run(onChange: () => void = () => {}): Promise<boolean> {
    this.startTime = Date.now();

    // "Before" sequence. Runs in parallel on all hosts (even on those that
    // don't have any new migration versions). If we fail, don't even start the
    // migrations.
    this.workers.push(
      ...this.beforeChains.map((chain) => new Worker([chain], {})),
    );
    await promiseAllMap(this.workers, async (worker) => worker.run(onChange));
    if (this.getNumErrors()) {
      return false;
    }

    // Main migration. Create up to workersPerHost workers for each host; all
    // the workers will run in parallel and apply migration chains to various
    // shards until there is no more chains in the queue.
    const semaphores = {};
    const chainsByDest = groupBy(this.chains, (entry) => entry.dest.getName());
    for (const chainsQueue of Object.values(chainsByDest)) {
      // For each one host, start as many workers as independent chains we have
      // in chainsQueue, but not more than this.workersPerHost. Each worker will
      // pick up jobs (chains) from the shared chainsQueue then.
      for (
        let i = 0;
        i < Math.min(chainsQueue.length, this.workersPerHost);
        i++
      ) {
        this.workers.push(new Worker(chainsQueue, semaphores));
      }

      this.totalMigrations += sum(
        chainsQueue.map((entry) => entry.migrations.length),
      );
    }

    await promiseAllMap(this.workers, async (worker) => worker.run(onChange));

    // "After" sequence (we run it even on errors above). Runs on all hosts. We
    // don't clear this._workers here: we want to keep the history of errors.
    this.workers.push(
      ...this.afterChains.map((chain) => new Worker([chain], {})),
    );
    await promiseAllMap(this.workers, async (worker) => worker.run(onChange));
    if (this.getNumErrors()) {
      return false;
    }

    // All done.
    return this.getNumErrors() === 0;
  }
}
