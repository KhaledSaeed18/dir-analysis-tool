import type { AnalysisResult, CompactInfo, CompactList, DuplicateGroup } from '../types.ts';

export interface CompactOptions {
    /** Maximum number of items kept in each list (a whole number of at least 0). */
    limit: number;
}

/**
 * Bounds every list in an analysis result to `limit` items, for scripts and
 * agents that read the JSON. Counts and sizes stay the full totals; what was
 * cut is listed in `compact.omitted`. Returns a new result and leaves the
 * input untouched.
 *
 * Cut: `extensions`, the `items` of `largeFiles`, `duplicates`, `emptyFiles`,
 * `emptyDirectories`, and `staleFiles`, the `files` of each listed duplicate
 * group, and `errors`. Not cut: `summary`, `types`, `budgets`, and the lists
 * already bounded by `top` or by the tree's own per-folder limit.
 */
export function compactAnalysis(result: AnalysisResult, options: CompactOptions): AnalysisResult {
    const { limit } = options;
    if (!Number.isSafeInteger(limit) || limit < 0) {
        throw new RangeError(`compact limit must be a whole number of at least 0 (got ${limit}).`);
    }
    const previous = result.compact?.omitted ?? {};
    const cuts: Array<[CompactList, number]> = [];
    const note = (list: CompactList, total: number, shown: number): void => {
        if (total > shown) cuts.push([list, total - shown]);
    };
    const cut = <T>(list: CompactList, items: T[], total: number): T[] => {
        const shown = items.slice(0, limit);
        note(list, Math.max(total, items.length), shown.length);
        return shown;
    };

    const out: AnalysisResult = { ...result };
    out.extensions = cut(
        'extensions',
        result.extensions,
        result.extensions.length + (previous.extensions ?? 0)
    );
    out.errors = cut('errors', result.errors, result.summary.errors);
    if (result.largeFiles) {
        const s = result.largeFiles;
        out.largeFiles = { ...s, items: cut('largeFiles.items', s.items, s.count) };
    }
    if (result.emptyFiles) {
        const s = result.emptyFiles;
        out.emptyFiles = { ...s, items: cut('emptyFiles.items', s.items, s.count) };
    }
    if (result.emptyDirectories) {
        const s = result.emptyDirectories;
        out.emptyDirectories = { ...s, items: cut('emptyDirectories.items', s.items, s.count) };
    }
    if (result.staleFiles) {
        const s = result.staleFiles;
        out.staleFiles = { ...s, items: cut('staleFiles.items', s.items, s.count) };
    }
    if (result.duplicates) {
        const s = result.duplicates;
        let cutFiles = 0;
        const items = cut('duplicates.items', s.items, s.count).map((group): DuplicateGroup => {
            const copies = group.files.length + (group.omittedFiles ?? 0);
            if (copies <= limit && group.omittedFiles === undefined) return group;
            const files = group.files.slice(0, limit);
            cutFiles += copies - files.length;
            return { ...group, files, omittedFiles: copies - files.length };
        });
        out.duplicates = { ...s, items };
        note('duplicates.items[].files', cutFiles, 0);
    }

    // Report cuts in the order their sections appear in the result.
    const order = Object.keys(result);
    const position = (list: CompactList): number => order.indexOf(list.split('.')[0]!);
    cuts.sort((a, b) => position(a[0]) - position(b[0]));
    const omitted: Partial<Record<CompactList, number>> = Object.fromEntries(cuts);

    const info: CompactInfo = {
        limit,
        truncated: cuts.length > 0,
        omitted,
    };
    out.compact = info;
    return out;
}
