/**
 * A tiny concurrency limiter for filesystem work.
 *
 * Tasks run at most `concurrency` at a time. Pending tasks are taken
 * last-in-first-out, which makes a directory walk proceed depth-first and
 * keeps the pending queue small even on very wide trees.
 */
export class Limiter {
    readonly #concurrency: number;
    readonly #queue: Array<() => Promise<void>> = [];
    #active = 0;
    #failure: unknown = undefined;
    #failed = false;
    #idle: { resolve: () => void; reject: (reason: unknown) => void } | null = null;

    constructor(concurrency: number) {
        if (!Number.isInteger(concurrency) || concurrency < 1) {
            throw new RangeError(`concurrency must be a positive integer (got ${concurrency})`);
        }
        this.#concurrency = concurrency;
    }

    /** Schedules a task. Tasks are expected to handle their own errors; a thrown error aborts the run. */
    run(task: () => Promise<void>): void {
        if (this.#failed) return;
        this.#queue.push(task);
        this.#pump();
    }

    /** Resolves once every scheduled task, including tasks scheduled by tasks, has finished. */
    idle(): Promise<void> {
        if (this.#failed) return Promise.reject(this.#failure);
        if (this.#active === 0 && this.#queue.length === 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            this.#idle = { resolve, reject };
        });
    }

    /** Stops scheduling new work and rejects `idle()` with `reason`. */
    abort(reason: unknown): void {
        if (this.#failed) return;
        this.#failed = true;
        this.#failure = reason;
        this.#queue.length = 0;
        this.#idle?.reject(reason);
        this.#idle = null;
    }

    #pump(): void {
        while (this.#active < this.#concurrency && this.#queue.length > 0) {
            const task = this.#queue.pop()!;
            this.#active++;
            task().then(this.#onDone, this.#onError);
        }
        if (this.#active === 0 && this.#queue.length === 0 && this.#idle) {
            const idle = this.#idle;
            this.#idle = null;
            idle.resolve();
        }
    }

    readonly #onDone = (): void => {
        this.#active--;
        this.#pump();
    };

    readonly #onError = (error: unknown): void => {
        this.#active--;
        this.abort(error);
    };
}
