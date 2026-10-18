import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';
import { joinRelative } from '../core/paths.ts';
import { errorCode } from '../errors.ts';

export interface TreeWatcherOptions {
    root: string;
    /** Root-relative `/` paths of events to ignore (excluded paths). */
    isIgnored: (relPath: string) => boolean;
    onChange: (relPath: string) => void;
    /** A watcher failed (for example, the OS ran out of watch handles). */
    onError: (error: Error) => void;
    /** Watch the whole tree with one recursive watcher. Default: true on macOS and Windows. */
    recursive?: boolean | undefined;
}

/**
 * Watches a directory tree with the platform's native facility.
 *
 * macOS and Windows support efficient recursive watching of a whole tree.
 * On Linux, recursive watching would register every directory, including
 * huge excluded ones like `node_modules`, so one watcher is kept per
 * directory that the scan actually enters, re-synced after each run.
 */
export class TreeWatcher {
    readonly #options: TreeWatcherOptions;
    readonly #watchers = new Map<string, FSWatcher>();
    readonly #recursive: boolean;
    #closed = false;

    constructor(options: TreeWatcherOptions) {
        this.#options = options;
        this.#recursive =
            options.recursive ?? (process.platform === 'darwin' || process.platform === 'win32');
    }

    get recursive(): boolean {
        return this.#recursive;
    }

    /** Starts or re-syncs watchers. `directories` is only used on Linux. */
    sync(directories: readonly string[]): void {
        if (this.#closed) return;
        if (this.#recursive) {
            if (this.#watchers.size === 0) this.#add('', true);
            return;
        }
        const wanted = new Set(directories);
        for (const [dir, watcher] of this.#watchers) {
            if (!wanted.has(dir)) {
                watcher.close();
                this.#watchers.delete(dir);
            }
        }
        for (const dir of wanted) if (!this.#watchers.has(dir)) this.#add(dir, false);
    }

    close(): void {
        this.#closed = true;
        for (const watcher of this.#watchers.values()) watcher.close();
        this.#watchers.clear();
    }

    #add(dir: string, recursive: boolean): void {
        let watcher: FSWatcher;
        try {
            watcher = watch(joinRelative(this.#options.root, dir), { recursive, persistent: true });
        } catch (error) {
            this.#options.onError(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        watcher.on('change', (_event, filename) => {
            const name = filename === null ? '' : String(filename);
            const native = sep === '/' ? name : name.replaceAll(sep, '/');
            const rel = dir && native ? `${dir}/${native}` : dir || native;
            if (rel && this.#options.isIgnored(rel)) return;
            this.#options.onChange(rel);
        });
        watcher.on('error', (error) => {
            watcher.close();
            this.#watchers.delete(dir);
            // A watched directory disappearing is a normal change, not a failure.
            const code = errorCode(error);
            if (code === 'ENOENT' || code === 'EPERM') {
                this.#options.onChange(dir);
            } else {
                this.#options.onError(error);
            }
        });
        this.#watchers.set(dir, watcher);
    }
}
