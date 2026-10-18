/**
 * Public result types. Every result is plain, JSON-serializable data: what the
 * library returns is exactly what `--format json` prints.
 *
 * Paths inside results are relative to `root` and always use `/` separators,
 * so reports are identical across operating systems.
 */

import type { ByteUnits } from './format/bytes.ts';

export const CATEGORIES = [
    'code',
    'documents',
    'images',
    'videos',
    'audio',
    'archives',
    'fonts',
    'data',
    'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface SizeStat {
    files: number;
    bytes: number;
}

export interface FileEntry {
    path: string;
    bytes: number;
    /** Last modification time, ISO 8601. */
    modified: string;
}

export interface DirectoryEntry {
    path: string;
    /** Total apparent size of everything below this directory. */
    bytes: number;
    /** Total number of files below this directory. */
    files: number;
}

export interface ExtensionStat extends SizeStat {
    /** Lowercased extension including the dot, or `""` for files without one. */
    extension: string;
}

export interface DuplicateGroup {
    /** SHA-256 of the file contents, hex encoded. */
    hash: string;
    /** Size of each copy. */
    bytes: number;
    /** Space reclaimable by keeping one copy: `bytes * (files.length - 1)`. */
    wastedBytes: number;
    files: string[];
}

export interface ItemList<T> {
    /** Number of matching items. */
    count: number;
    /** Combined size of the matching items. */
    bytes: number;
    items: T[];
}

export interface ScanError {
    path: string;
    /** Node.js error code, for example `EACCES` or `ELOOP`. */
    code: string;
    message: string;
}

export interface TreeNode {
    name: string;
    path: string;
    type: 'directory' | 'file';
    bytes: number;
    files: number;
    children?: TreeNode[];
    /** Children not shown because of the per-level limit. */
    omitted?: SizeStat & { entries: number };
}

export type BudgetMetric =
    | 'size'
    | 'disk'
    | 'files'
    | 'dirs'
    | 'largest'
    | 'large'
    | 'duplicates'
    | 'wasted'
    | 'empty'
    | 'stale'
    | 'errors';

export type BudgetOperator = '<' | '<=' | '>' | '>=' | '=' | '!=';

export interface BudgetResult {
    /** The rule as written, for example `size<=500MB`. */
    rule: string;
    metric: BudgetMetric;
    operator: BudgetOperator;
    limit: number;
    actual: number;
    passed: boolean;
}

export interface Summary {
    /** Apparent size: the sum of file lengths. */
    bytes: number;
    /** Allocated size on disk (block usage). Equals `bytes` where the platform does not report blocks. */
    diskBytes: number;
    files: number;
    directories: number;
    /** Size of the largest file. */
    largestFileBytes: number;
    symlinks: number;
    /** Extra hard links skipped so that shared data is counted once. */
    hardlinks: number;
    /** Entries skipped by exclusion rules (default excludes, --exclude, .gitignore). */
    excluded: number;
    /** Files skipped by size or date filters. */
    filtered: number;
    /** Paths that could not be read. */
    errors: number;
}

export interface ToolInfo {
    name: string;
    version: string;
}

export interface AnalysisSettings {
    exclude: string[];
    defaultExcludes: boolean;
    gitignore: boolean;
    maxDepth: number | null;
    followSymlinks: boolean;
    countHardlinks: boolean;
    minSize: number | null;
    maxSize: number | null;
    modifiedAfter: string | null;
    modifiedBefore: string | null;
}

export interface AnalysisResult {
    schemaVersion: 3;
    tool: ToolInfo;
    /** Absolute path of the analyzed directory. */
    root: string;
    startedAt: string;
    durationMs: number;
    settings: AnalysisSettings;
    summary: Summary;
    /** Every category is always present, including empty ones. */
    types: Record<Category, SizeStat>;
    /** Sorted by size, largest first. */
    extensions: ExtensionStat[];
    largestDirectories: DirectoryEntry[];
    largestFiles: FileEntry[];
    largeFiles?: ItemList<FileEntry> & { threshold: number };
    duplicates?: ItemList<DuplicateGroup> & { files: number; wastedBytes: number };
    emptyFiles?: ItemList<FileEntry>;
    emptyDirectories?: { count: number; items: string[] };
    staleFiles?: ItemList<FileEntry> & { modifiedBefore: string };
    tree?: TreeNode;
    budgets?: BudgetResult[];
    /** At most 100 entries; `summary.errors` has the full count. */
    errors: ScanError[];
}

export interface ChangedFile {
    path: string;
    leftBytes: number;
    rightBytes: number;
    delta: number;
}

export interface DirectoryDelta {
    path: string;
    leftBytes: number;
    rightBytes: number;
    delta: number;
}

export interface ComparisonSide {
    root: string;
    summary: Summary;
    types: Record<Category, SizeStat>;
}

export interface ComparisonResult {
    schemaVersion: 3;
    tool: ToolInfo;
    startedAt: string;
    durationMs: number;
    /** How `changed` was decided: by size only, or by size then content hash. */
    mode: 'size' | 'content';
    left: ComparisonSide;
    right: ComparisonSide;
    delta: { bytes: number; diskBytes: number; files: number; directories: number };
    added: ItemList<FileEntry>;
    removed: ItemList<FileEntry>;
    changed: { count: number; delta: number; items: ChangedFile[] };
    unchanged: number;
    /** Directories with the largest size change, largest absolute change first. */
    directories: DirectoryDelta[];
}

export type { ByteUnits };
