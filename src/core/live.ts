import type { Stats } from 'node:fs';
import { basename } from 'node:path';
import type { AnalysisResult, ScanError } from '../types.ts';
import {
    Collector,
    createProgressReporter,
    resolveFeatures,
    type AnalyzeOptions,
    type CollectingTree,
    type Candidate,
    CANDIDATE_DIGESTS,
    type Features,
    type ScanTree,
} from './analyze.ts';
import { evaluateBudgets } from './budgets.ts';
import type { IgnoreChain } from './exclude.ts';
import { resolveScan, type ResolvedScan } from './options.ts';
import { comparePaths, joinRelative } from './paths.ts';
import {
    compareRelativePaths,
    diskBytesOf,
    MAX_ERROR_DETAILS,
    passesFilters,
    relativePathOf,
    rollUp,
    Scanner,
    scanError,
    type DirNode,
    type ScanCounters,
    type ScanOptions,
} from './scanner.ts';

/** Changed paths in one update beyond which a full scan is cheaper than tracking them. */
export const MAX_CHANGED_PATHS = 1000;
/** Share of all folders an update may touch before it becomes a full scan (at least 32 folders). */
export const MAX_DIRTY_SHARE = 0.1;
const MIN_DIRTY_FOLDERS = 32;

/** A file with several hard links, as the scan found it. */
interface LinkedFile {
    name: string;
    stats: Stats;
    key: string;
}

/** Everything one folder contributes to a report, from its own entries only. */
interface Folder {
    rel: string;
    parent: Folder | null;
    depth: number;
    /** Ignore rules the folder inherits (its own `.gitignore` is read when it is scanned). */
    chain: IgnoreChain;
    node: DirNode;
    collector: Collector;
    excluded: number;
    filtered: number;
    symlinks: number;
    errorCount: number;
    /** Error details, at most {@link MAX_ERROR_DETAILS}, the first by path. */
    errors: ScanError[] | null;
    links: LinkedFile[] | null;
    /** Subfolders by name; null for a folder without any (most of them). */
    children: Map<string, Folder> | null;
}

/** How a report was produced. */
export interface LiveUpdate {
    result: AnalysisResult;
    /** `full` when everything was scanned again, `incremental` when only changed folders were. */
    mode: 'full' | 'incremental';
    /** Folders read again (all of them for a full scan). */
    folders: number;
}

/**
 * An analysis kept up to date folder by folder, for `dat watch`.
 *
 * Each folder keeps what its own entries contribute: totals, file types and
 * extensions, its own top files and the entries of opt-in reports, through a
 * {@link Collector} of its own. A change re-reads only the folders it touched
 * (and scans new subfolders), then every report is built by merging the
 * folders' collectors with the same code `analyze` uses, so it is what a full
 * scan would report. Memory grows with the folders, not the files, except for
 * duplicate candidates, which `-d` keeps per file as it always does.
 *
 * Options it cannot follow incrementally make {@link LiveAnalysis.create}
 * return null: following symlinks (folders are then identified across the
 * tree) and relative dates, whose cutoffs move between reports.
 */
export class LiveAnalysis {
    readonly #options: AnalyzeOptions;
    readonly #scan: ResolvedScan;
    readonly #features: Features;
    readonly #folders = new Map<string, Folder>();
    readonly #stamps: boolean;

    private constructor(options: AnalyzeOptions, scan: ResolvedScan, features: Features) {
        this.#options = options;
        this.#scan = scan;
        this.#features = features;
        this.#stamps = features.duplicates;
    }

    /** Scans `path` in full, or returns null when the options rule out incremental updates. */
    static async create(
        path: string,
        options: AnalyzeOptions = {}
    ): Promise<{ live: LiveAnalysis; update: LiveUpdate } | null> {
        if (options.followSymlinks) return null;
        const now = Date.now();
        const scan = await resolveScan(path, options, now);
        const features = resolveFeatures(options, now);
        // Ages such as --stale 1y or --newer-than 30d resolve to a different cutoff later.
        const later = now + 400 * 24 * 60 * 60 * 1000;
        const moved = await resolveScan(path, options, later);
        if (
            moved.settings.modifiedAfter !== scan.settings.modifiedAfter ||
            moved.settings.modifiedBefore !== scan.settings.modifiedBefore ||
            resolveFeatures(options, later).staleBefore !== features.staleBefore
        ) {
            return null;
        }
        const { onProgress, ...kept } = options;
        const live = new LiveAnalysis(kept, scan, features);
        return { live, update: await live.rescan(onProgress) };
    }

    /** Root-relative paths of every folder the analysis entered, the root as `''`. */
    get directories(): string[] {
        return [...this.#folders.keys()];
    }

    /** Scans everything again, reporting progress like `analyze` when asked to. */
    async rescan(onProgress?: AnalyzeOptions['onProgress']): Promise<LiveUpdate> {
        const started = performance.now();
        const startedAt = Date.now();
        this.#folders.clear();
        let scanned: Scanner | null = null;
        const progress = createProgressReporter(onProgress, this.#options.progressInterval, () => ({
            phase: 'scan' as const,
            files: scanned?.counters.files ?? 0,
            directories: scanned?.counters.directories ?? 0,
            bytes: scanned?.counters.bytes ?? 0,
            errors: scanned?.counters.errors ?? 0,
        }));
        try {
            await this.#scanTree('', null, null, 0, (scanner) => (scanned = scanner));
            progress.flush();
        } finally {
            progress.stop();
        }
        return {
            result: await this.#build(startedAt, started),
            mode: 'full',
            folders: this.#folders.size,
        };
    }

    /**
     * Updates the analysis after changes at `paths` (root-relative, `/`
     * separators, as a watcher reports them: the entry that changed, or a
     * folder whose contents did). Falls back to a full scan when that is
     * cheaper or when a change can affect folders it does not name.
     */
    async update(paths: Iterable<string>): Promise<LiveUpdate> {
        const started = performance.now();
        const startedAt = Date.now();
        const changed = [...new Set(paths)];
        if (changed.length > MAX_CHANGED_PATHS || !this.#folders.has('')) return this.rescan();
        // A .gitignore applies to a whole subtree, and its rules are read once per folder scan.
        if (this.#scan.options.excluder.gitignore && changed.some(isIgnoreFile)) {
            return this.rescan();
        }

        const named = new Set(changed);
        const dirty = new Set<Folder>();
        for (const path of changed) {
            const folder = this.#folders.get(path);
            if (folder) dirty.add(folder);
            // The folder holding the entry, or the closest one known (for paths inside new folders).
            let parent = parentOf(path);
            while (parent !== null && !this.#folders.has(parent)) parent = parentOf(parent);
            if (parent !== null) dirty.add(this.#folders.get(parent)!);
        }
        if (dirty.size > Math.max(MIN_DIRTY_FOLDERS, this.#folders.size * MAX_DIRTY_SHARE)) {
            return this.rescan();
        }

        // Parents first: re-reading one can remove a dirty subfolder or add it as new.
        const queue = [...dirty].sort((a, b) => a.depth - b.depth);
        let folders = 0;
        while (queue.length > 0) {
            const folder = queue.shift()!;
            if (this.#folders.get(folder.rel) !== folder) continue; // removed meanwhile
            folders += await this.#relist(folder, queue, named);
        }
        return {
            result: await this.#build(startedAt, started),
            mode: 'incremental',
            folders,
        };
    }

    /** Re-reads one folder's own entries; removes vanished subfolders and scans new ones. */
    async #relist(folder: Folder, queue: Folder[], named: ReadonlySet<string>): Promise<number> {
        const subfolders = new Map<string, IgnoreChain>();
        const fresh = await this.#scanFolder(folder, subfolders);
        if (this.#stamps) keepDigests(folder, fresh, named);
        if (fresh.node.entries === -1 && folder.parent && isGone(fresh.errors ?? [])) {
            // The folder itself is gone: its parent's listing says what replaced it.
            if (!queue.includes(folder.parent)) queue.unshift(folder.parent);
            return 1;
        }
        Object.assign(folder, { ...fresh, children: folder.children });
        let read = 1;
        for (const [name, child] of folder.children ?? []) {
            if (!subfolders.has(name)) this.#remove(child);
        }
        for (const [name, chain] of subfolders) {
            if (folder.children?.has(name)) continue;
            const rel = folder.rel ? `${folder.rel}/${name}` : name;
            read += await this.#scanTree(rel, folder, chain, folder.depth + 1);
        }
        return read;
    }

    #remove(folder: Folder): void {
        for (const child of folder.children?.values() ?? []) this.#remove(child);
        this.#folders.delete(folder.rel);
        const siblings = folder.parent?.children;
        siblings?.delete(basename(folder.rel));
        if (siblings?.size === 0) folder.parent!.children = null;
    }

    /** Scans a folder and everything below it, adding a record for each folder. */
    async #scanTree(
        rel: string,
        parent: Folder | null,
        chain: IgnoreChain | null,
        depth: number,
        onScanner?: (scanner: Scanner) => void
    ): Promise<number> {
        const local: Folder[] = [];
        const scanner = this.#scanner(
            rel,
            chain === null ? undefined : { rel, chain, depth, shallow: false },
            {
                directory: (index, node, inherited) => {
                    const up = node.parent >= 0 ? local[node.parent]! : parent;
                    const folderRel = up && index > 0 ? join(up.rel, node.name) : rel;
                    const folder = this.#newFolder(folderRel, up, node, inherited);
                    local[index] = folder;
                    this.#folders.set(folderRel, folder);
                    if (up) (up.children ??= new Map()).set(basename(folderRel), folder);
                },
                folderOf: (index) => local[index]!,
            }
        );
        onScanner?.(scanner);
        await scanner.run();
        return local.length;
    }

    /** Reads only `folder`'s own entries, into a fresh record; subfolders go to `subfolders`. */
    async #scanFolder(folder: Folder, subfolders: Map<string, IgnoreChain>): Promise<Folder> {
        let fresh: Folder | null = null;
        const scanner = this.#scanner(
            folder.rel,
            { rel: folder.rel, chain: folder.chain, depth: folder.depth, shallow: true },
            {
                directory: (_index, node, inherited) => {
                    fresh = this.#newFolder(folder.rel, folder.parent, node, inherited);
                },
                folderOf: () => fresh!,
                subfolder: (name, chain) => subfolders.set(name, chain),
            }
        );
        await scanner.run();
        return fresh!;
    }

    #scanner(
        rel: string,
        start: ScanOptions['start'],
        route: {
            directory: (index: number, node: DirNode, chain: IgnoreChain) => void;
            folderOf: (index: number) => Folder;
            subfolder?: (name: string, chain: IgnoreChain) => void;
        }
    ): Scanner {
        const base = this.#scan.options;
        return new Scanner(
            {
                ...base,
                root: joinRelative(base.root, rel),
                start,
                signal: this.#options.signal,
                onSkip: (event) => {
                    const folder = route.folderOf(event.dir);
                    if (event.kind === 'excluded') folder.excluded++;
                    else if (event.kind === 'filtered') folder.filtered++;
                    else if (event.kind === 'symlink') folder.symlinks++;
                },
                onLinkedFile: (dir, name, stats, key) => {
                    (route.folderOf(dir).links ??= []).push({ name, stats, key });
                },
                onError: (dir, detail) => {
                    const folder = route.folderOf(dir);
                    const local = detail.path === '.' ? '' : detail.path;
                    const path = join(rel, local) || '.';
                    addError(folder, { ...detail, path });
                },
            },
            {
                directory: route.directory,
                file: (dir, name, stats) => route.folderOf(dir).collector.file(0, name, stats),
                ...(route.subfolder
                    ? { subfolder: (_parent, name, chain) => route.subfolder!(name, chain) }
                    : {}),
            }
        );
    }

    #newFolder(rel: string, parent: Folder | null, node: DirNode, chain: IgnoreChain): Folder {
        const collector = new Collector(this.#features, this.#stamps);
        // The folder's own collector sees one directory, the folder, at its real depth.
        collector.attach(new FolderView(node));
        return {
            rel,
            parent,
            depth: node.depth,
            chain,
            node,
            collector,
            excluded: 0,
            filtered: 0,
            symlinks: 0,
            errorCount: 0,
            errors: null,
            links: null,
            children: null,
        };
    }

    /** Merges every folder into one report, the way `analyze` builds it from one scan. */
    async #build(startedAt: number, started: number): Promise<AnalysisResult> {
        const features = this.#features;
        const tree = new MergedTree(this.#scan.options.root);
        const collector = new Collector(features, this.#stamps);
        collector.attach(tree);

        const index = new Map<Folder, number>();
        const errors: ScanError[] = [];
        const visit = (folder: Folder, parent: number): void => {
            const node = folder.node;
            const i =
                tree.dirs.push({
                    name: folder.parent ? basename(folder.rel) : '',
                    parent,
                    depth: folder.depth,
                    entries: node.entries,
                    ownFiles: node.ownFiles,
                    ownBytes: node.ownBytes,
                    ownDiskBytes: node.ownDiskBytes,
                    files: 0,
                    bytes: 0,
                    diskBytes: 0,
                    largestChild: 0,
                }) - 1;
            index.set(folder, i);
            const c = tree.counters;
            c.directories++;
            c.files += node.ownFiles;
            c.bytes += node.ownBytes;
            c.diskBytes += node.ownDiskBytes;
            c.excluded += folder.excluded;
            c.filtered += folder.filtered;
            c.symlinks += folder.symlinks;
            c.errors += folder.errorCount;
            if (folder.errors) errors.push(...folder.errors);
            collector.directory(i, tree.dirs[i]!);
            collector.absorb(folder.collector, i);
            for (const child of folder.children?.values() ?? []) visit(child, i);
        };
        visit(this.#folders.get('')!, -1);
        this.#countLinks(tree, collector, index);
        errors.sort((a, b) => comparePaths(a.path, b.path));
        tree.errors.push(...errors.slice(0, MAX_ERROR_DETAILS));
        rollUp(tree.dirs);

        let duplicates: AnalysisResult['duplicates'];
        if (features.duplicates) {
            duplicates = await collector.findDuplicates(
                tree,
                this.#scan.options.concurrency,
                this.#options.signal,
                () => {},
                CANDIDATE_DIGESTS
            );
        }

        const result = collector.build(tree, {
            root: this.#scan.options.root,
            startedAt,
            settings: this.#scan.settings,
            duplicates,
        });
        if (features.budgets.length > 0) result.budgets = evaluateBudgets(features.budgets, result);
        result.durationMs = Math.round(performance.now() - started);
        return result;
    }

    /**
     * Counts each set of hard links once, under the link whose path sorts
     * first, so the choice never depends on which link a scan reached first.
     */
    #countLinks(tree: MergedTree, collector: Collector, index: Map<Folder, number>): void {
        const byKey = new Map<string, Array<{ folder: Folder; file: LinkedFile }>>();
        for (const folder of this.#folders.values()) {
            for (const file of folder.links ?? []) {
                const links = byKey.get(file.key);
                if (links) links.push({ folder, file });
                else byKey.set(file.key, [{ folder, file }]);
            }
        }
        const options = this.#scan.options;
        for (const links of byKey.values()) {
            tree.counters.hardlinks += links.length - 1;
            const { folder, file } = links.reduce((a, b) =>
                comparePaths(join(a.folder.rel, a.file.name), join(b.folder.rel, b.file.name)) <= 0
                    ? a
                    : b
            );
            if (!passesFilters(options, file.stats)) {
                tree.counters.filtered++;
                continue;
            }
            const dir = index.get(folder)!;
            const node = tree.dirs[dir]!;
            const diskBytes = diskBytesOf(file.stats);
            node.ownFiles++;
            node.ownBytes += file.stats.size;
            node.ownDiskBytes += diskBytes;
            tree.counters.files++;
            tree.counters.bytes += file.stats.size;
            tree.counters.diskBytes += diskBytes;
            collector.file(dir, file.name, file.stats);
        }
    }
}

/** The merged folders of a live analysis, as one scan's tree for {@link Collector.build}. */
class MergedTree implements ScanTree {
    readonly dirs: DirNode[] = [];
    readonly errors: ScanError[] = [];
    readonly counters: ScanCounters = emptyCounters();
    readonly #root: string;

    constructor(root: string) {
        this.#root = root;
    }

    relativePath(dir: number, name?: string): string {
        return relativePathOf(this.dirs, dir, name);
    }

    absolutePath(dir: number, name?: string): string {
        return joinRelative(this.#root, this.relativePath(dir, name));
    }

    compareRelative(
        dirA: number,
        nameA: string | undefined,
        dirB: number,
        nameB: string | undefined
    ): number {
        return compareRelativePaths(this.dirs, dirA, nameA, dirB, nameB);
    }

    recordError(path: string, error: unknown): void {
        this.counters.errors++;
        if (this.errors.length < MAX_ERROR_DETAILS) this.errors.push(scanError(path, error));
    }
}

/** One folder seen as a whole tree, for that folder's own collector. */
class FolderView implements CollectingTree {
    readonly dirs: readonly DirNode[];

    constructor(node: DirNode) {
        this.dirs = [node];
    }

    /** Within one folder, paths differ only by name. */
    compareRelative(
        _dirA: number,
        nameA: string | undefined,
        _dirB: number,
        nameB: string | undefined
    ): number {
        return comparePaths(nameA ?? '', nameB ?? '');
    }
}

/**
 * Moves digests from a folder's old candidates to the new ones for files that
 * kept their size, timestamps and identity and that no event named, so only
 * files that changed are read again.
 */
function keepDigests(old: Folder, fresh: Folder, named: ReadonlySet<string>): void {
    const before = new Map<string, Candidate>();
    for (const candidate of old.collector.candidates()) {
        if (candidate.digests) before.set(candidate.name, candidate);
    }
    if (before.size === 0) return;
    for (const candidate of fresh.collector.candidates()) {
        const previous = before.get(candidate.name);
        const digests = previous?.digests;
        if (
            previous &&
            digests &&
            previous.bytes === candidate.bytes &&
            previous.mtimeMs === candidate.mtimeMs &&
            previous.ctimeMs === candidate.ctimeMs &&
            previous.ino === candidate.ino &&
            previous.dev === candidate.dev &&
            !named.has(join(old.rel, candidate.name))
        ) {
            candidate.digests = digests;
        }
    }
}

function emptyCounters(): ScanCounters {
    return {
        files: 0,
        bytes: 0,
        diskBytes: 0,
        directories: 0,
        symlinks: 0,
        hardlinks: 0,
        excluded: 0,
        filtered: 0,
        errors: 0,
    };
}

/** Adds an error to a folder, keeping only the {@link MAX_ERROR_DETAILS} first by path. */
export function addError(folder: Pick<Folder, 'errorCount' | 'errors'>, detail: ScanError): void {
    folder.errorCount++;
    const errors = (folder.errors ??= []);
    errors.push(detail);
    if (errors.length > MAX_ERROR_DETAILS) {
        errors.sort((a, b) => comparePaths(a.path, b.path));
        errors.pop();
    }
}

function isGone(errors: readonly ScanError[]): boolean {
    return errors.some((e) => e.code === 'ENOENT' || e.code === 'ENOTDIR');
}

function isIgnoreFile(path: string): boolean {
    return path === '.gitignore' || path.endsWith('/.gitignore');
}

function join(dir: string, name: string): string {
    if (!dir) return name;
    return name ? `${dir}/${name}` : dir;
}

/** The folder a root-relative path is in: `''` for the root's entries, null for the root. */
function parentOf(path: string): string | null {
    if (path === '') return null;
    const slash = path.lastIndexOf('/');
    return slash < 0 ? '' : path.slice(0, slash);
}
