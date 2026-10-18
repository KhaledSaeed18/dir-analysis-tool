import { formatBytes, type ByteUnits } from '../format/bytes.ts';
import { createStyle, type Style } from '../format/style.ts';
import { formatAge, formatElapsed } from '../format/time.ts';
import {
    bar,
    formatCount,
    formatPercent,
    padEndVisible,
    padStartVisible,
    plural,
    truncateMiddle,
} from '../format/text.ts';
import {
    CATEGORIES,
    type AnalysisResult,
    type Category,
    type ComparisonResult,
    type FileEntry,
    type TreeNode,
} from '../types.ts';

export interface PrettyOptions {
    style?: Style;
    units?: ByteUnits;
    /** Terminal width used to fit paths. Default: 100. */
    width?: number;
    /** Maximum items printed per list. Default: 10. */
    limit?: number;
    /** Show the file type breakdown. Default: true. */
    types?: boolean;
    /** Show the extension breakdown. Default: false. */
    extensions?: boolean;
    /** Reference time for ages. Default: now. */
    now?: number;
}

const CATEGORY_LABELS: Record<Category, string> = {
    code: 'Code',
    documents: 'Documents',
    images: 'Images',
    videos: 'Videos',
    audio: 'Audio',
    archives: 'Archives',
    fonts: 'Fonts',
    data: 'Data',
    other: 'Other',
};

const SIZE_WIDTH = 10;
const BAR_WIDTH = 16;

class Renderer {
    readonly lines: string[] = [];
    readonly s: Style;
    readonly units: ByteUnits;
    readonly width: number;
    readonly limit: number;

    constructor(options: PrettyOptions) {
        this.s = options.style ?? createStyle(false);
        this.units = options.units ?? 'iec';
        this.width = Math.max(60, options.width ?? 100);
        this.limit = Math.max(1, options.limit ?? 10);
    }

    bytes(value: number): string {
        return formatBytes(value, this.units);
    }

    size(value: number): string {
        return this.s.cyan(padStartVisible(this.bytes(value), SIZE_WIDTH));
    }

    heading(text: string, detail?: string): void {
        this.lines.push('');
        this.lines.push(` ${this.s.bold(text)}${detail ? `  ${this.s.dim(detail)}` : ''}`);
    }

    line(text = ''): void {
        this.lines.push(text);
    }

    /** Space left for a path after `used` columns. */
    room(used: number): number {
        return Math.max(20, this.width - used);
    }

    more(shown: number, total: number, noun = 'more'): void {
        if (total > shown) this.line(`   ${this.s.dim(`… ${formatCount(total - shown)} ${noun}`)}`);
    }

    fileList(items: FileEntry[], total: number, extra?: (item: FileEntry) => string): void {
        const shown = items.slice(0, this.limit);
        for (const item of shown) {
            const suffix = extra ? `  ${this.s.dim(extra(item))}` : '';
            const used = 3 + SIZE_WIDTH + 2 + (extra ? extra(item).length + 2 : 0);
            this.line(
                `   ${this.size(item.bytes)}  ${truncateMiddle(item.path, this.room(used))}${suffix}`
            );
        }
        this.more(shown.length, total);
    }
}

/** Renders an analysis for a terminal. Colors only when `style` enables them. */
export function renderAnalysis(result: AnalysisResult, options: PrettyOptions = {}): string {
    const r = new Renderer(options);
    const { s } = r;
    const now = options.now ?? Date.now();
    const sum = result.summary;

    r.line(
        ` ${s.bold(s.blue('dat'))}  ${s.bold(truncateMiddle(result.root, r.room(20)))}  ${s.dim(formatElapsed(result.durationMs))}`
    );
    r.line('');
    const row = (label: string, value: string): void =>
        r.line(`   ${padEndVisible(s.dim(label), 10)}${value}`);
    const disk =
        sum.diskBytes !== sum.bytes ? `  ${s.dim(`(${r.bytes(sum.diskBytes)} on disk)`)}` : '';
    row('Size', `${s.bold(s.cyan(r.bytes(sum.bytes)))}${disk}`);
    row('Files', formatCount(sum.files));
    row('Folders', formatCount(sum.directories));
    if (sum.symlinks > 0) {
        row(
            'Symlinks',
            `${formatCount(sum.symlinks)} ${s.dim(result.settings.followSymlinks ? '(followed)' : '(not followed)')}`
        );
    }
    if (sum.hardlinks > 0) {
        row('Hardlinks', `${formatCount(sum.hardlinks)} ${s.dim('extra links counted once')}`);
    }
    const skipped: string[] = [];
    if (sum.excluded > 0) skipped.push(`${formatCount(sum.excluded)} excluded`);
    if (sum.filtered > 0) skipped.push(`${formatCount(sum.filtered)} filtered`);
    if (sum.errors > 0) skipped.push(s.yellow(`${formatCount(sum.errors)} unreadable`));
    if (skipped.length > 0) row('Skipped', skipped.join(s.dim(' · ')));

    if (options.types !== false && sum.files > 0) renderTypes(r, result);
    if (options.extensions && result.extensions.length > 0) renderExtensions(r, result);

    if (result.largestDirectories.length > 0) {
        r.heading('Largest folders');
        for (const dir of result.largestDirectories.slice(0, r.limit)) {
            const files = plural(dir.files, 'file');
            r.line(
                `   ${r.size(dir.bytes)}  ${truncateMiddle(`${dir.path}/`, r.room(3 + SIZE_WIDTH + 4 + files.length))}  ${s.dim(files)}`
            );
        }
    }
    if (result.largestFiles.length > 0) {
        r.heading('Largest files');
        r.fileList(result.largestFiles, result.largestFiles.length);
    }

    if (result.largeFiles) {
        const lf = result.largeFiles;
        r.heading(
            `Large files ≥ ${r.bytes(lf.threshold)}`,
            lf.count > 0 ? `${plural(lf.count, 'file')} · ${r.bytes(lf.bytes)}` : 'none'
        );
        r.fileList(lf.items, lf.count);
    }

    if (result.duplicates) renderDuplicates(r, result.duplicates);

    if (result.emptyFiles) {
        r.heading(
            'Empty files',
            result.emptyFiles.count > 0 ? plural(result.emptyFiles.count, 'file') : 'none'
        );
        for (const file of result.emptyFiles.items.slice(0, r.limit)) {
            r.line(`   ${truncateMiddle(file.path, r.room(3))}`);
        }
        r.more(Math.min(r.limit, result.emptyFiles.items.length), result.emptyFiles.count);
    }
    if (result.emptyDirectories) {
        const ed = result.emptyDirectories;
        r.heading('Empty folders', ed.count > 0 ? plural(ed.count, 'folder') : 'none');
        for (const dir of ed.items.slice(0, r.limit)) {
            r.line(`   ${truncateMiddle(`${dir}/`, r.room(3))}`);
        }
        r.more(Math.min(r.limit, ed.items.length), ed.count);
    }
    if (result.staleFiles) {
        const sf = result.staleFiles;
        r.heading(
            `Not modified since ${sf.modifiedBefore.slice(0, 10)}`,
            sf.count > 0 ? `${plural(sf.count, 'file')} · ${r.bytes(sf.bytes)}` : 'none'
        );
        r.fileList(sf.items, sf.count, (f) => `${formatAge(Date.parse(f.modified), now)} ago`);
    }

    if (result.tree) {
        r.heading('Tree');
        renderTree(r, result.tree);
    }

    if (result.errors.length > 0) {
        r.heading('Unreadable', plural(sum.errors, 'path'));
        const shown = result.errors.slice(0, 5);
        for (const error of shown) {
            const used = 3 + 8 + 2 + error.message.length;
            r.line(
                `   ${s.yellow(padEndVisible(error.code, 8))}${truncateMiddle(error.path, r.room(used))}  ${s.dim(error.message)}`
            );
        }
        r.more(shown.length, sum.errors);
    }

    if (result.budgets && result.budgets.length > 0) {
        const failed = result.budgets.filter((b) => !b.passed).length;
        r.heading('Budgets', failed > 0 ? s.red(`${failed} failed`) : s.green('all passed'));
        for (const budget of result.budgets) {
            const isSize = ['size', 'disk', 'largest', 'wasted'].includes(budget.metric);
            const actual = isSize ? r.bytes(budget.actual) : formatCount(budget.actual);
            const mark = budget.passed ? s.green('✔') : s.red('✘');
            r.line(
                `   ${mark} ${padEndVisible(budget.rule, 24)} ${s.dim('actual')} ${budget.passed ? actual : s.red(actual)}`
            );
        }
    }

    r.line('');
    return r.lines.join('\n');
}

function renderTypes(r: Renderer, result: AnalysisResult): void {
    const { s } = r;
    const total = result.summary.bytes;
    const rows = CATEGORIES.filter((c) => result.types[c].files > 0).sort(
        (a, b) =>
            result.types[b].bytes - result.types[a].bytes ||
            result.types[b].files - result.types[a].files
    );
    r.heading('File types');
    for (const category of rows) {
        const stat = result.types[category];
        r.line(
            `   ${padEndVisible(CATEGORY_LABELS[category], 10)} ${s.blue(bar(total > 0 ? stat.bytes / total : 0, BAR_WIDTH))} ${r.size(stat.bytes)} ${padStartVisible(formatPercent(stat.bytes, total), 5)}  ${s.dim(plural(stat.files, 'file'))}`
        );
    }
}

function renderExtensions(r: Renderer, result: AnalysisResult): void {
    const { s } = r;
    const total = result.summary.bytes;
    r.heading('Extensions', plural(result.extensions.length, 'distinct extension'));
    const shown = result.extensions.slice(0, r.limit);
    for (const ext of shown) {
        r.line(
            `   ${padEndVisible(ext.extension || s.dim('(none)'), 12)} ${r.size(ext.bytes)} ${padStartVisible(formatPercent(ext.bytes, total), 5)}  ${s.dim(plural(ext.files, 'file'))}`
        );
    }
    r.more(shown.length, result.extensions.length);
}

function renderDuplicates(
    r: Renderer,
    duplicates: NonNullable<AnalysisResult['duplicates']>
): void {
    const { s } = r;
    if (duplicates.count === 0) {
        r.heading('Duplicates', 'none found');
        return;
    }
    r.heading(
        'Duplicates',
        `${plural(duplicates.count, 'group')} · ${plural(duplicates.files, 'file')} · ${r.bytes(duplicates.wastedBytes)} reclaimable`
    );
    const shown = duplicates.items.slice(0, r.limit);
    for (const group of shown) {
        r.line(
            `   ${r.size(group.wastedBytes)}  ${s.dim(`${group.files.length} × ${r.bytes(group.bytes)}`)}`
        );
        const files = group.files.slice(0, 5);
        for (const file of files) {
            r.line(
                `   ${' '.repeat(SIZE_WIDTH)}  ${truncateMiddle(file, r.room(3 + SIZE_WIDTH + 2))}`
            );
        }
        if (group.files.length > files.length) {
            r.line(
                `   ${' '.repeat(SIZE_WIDTH)}  ${s.dim(`… ${group.files.length - files.length} more copies`)}`
            );
        }
    }
    r.more(shown.length, duplicates.count, 'more groups');
}

function renderTree(r: Renderer, root: TreeNode): void {
    const { s } = r;
    const walk = (node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean): void => {
        const connector = isRoot ? '' : isLast ? '└─ ' : '├─ ';
        const used = 3 + SIZE_WIDTH + 2 + prefix.length + connector.length;
        const label = node.type === 'directory' && !isRoot ? `${node.name}/` : node.name;
        const name = truncateMiddle(label, Math.max(12, r.width - used));
        r.line(
            `   ${r.size(node.bytes)}  ${s.dim(prefix + connector)}${node.type === 'directory' ? s.bold(name) : name}`
        );
        const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
        const children = node.children ?? [];
        children.forEach((child, i) =>
            walk(child, childPrefix, i === children.length - 1 && !node.omitted, false)
        );
        if (node.omitted) {
            r.line(
                `   ${r.size(node.omitted.bytes)}  ${s.dim(`${childPrefix}└─ … ${plural(node.omitted.entries, 'more entry', 'more entries')}`)}`
            );
        }
    };
    walk(root, '', true, true);
}

/** Renders a directory comparison for a terminal. */
export function renderComparison(result: ComparisonResult, options: PrettyOptions = {}): string {
    const r = new Renderer(options);
    const { s } = r;
    const signed = (n: number): string =>
        n > 0 ? s.green(`+${r.bytes(n)}`) : n < 0 ? s.red(r.bytes(n)) : s.dim('±0');
    const signedCount = (n: number): string =>
        n > 0 ? s.green(`+${formatCount(n)}`) : n < 0 ? s.red(`-${formatCount(-n)}`) : s.dim('±0');
    const pct = (left: number, right: number): string => {
        if (left === 0) return '';
        const value = ((right - left) / left) * 100;
        return s.dim(
            ` (${value > 0 ? '+' : ''}${Math.abs(value) < 0.1 && value !== 0 ? value.toFixed(2) : value.toFixed(1)}%)`
        );
    };

    r.line(` ${s.bold(s.blue('dat compare'))}  ${s.dim(formatElapsed(result.durationMs))}`);
    r.line('');
    r.line(`   ${s.dim('left ')}  ${truncateMiddle(result.left.root, r.room(12))}`);
    r.line(`   ${s.dim('right')}  ${truncateMiddle(result.right.root, r.room(12))}`);

    const col = (text: string): string => padStartVisible(text, 12);
    r.heading('Overview');
    r.line(
        `   ${padEndVisible('', 10)}${col(s.dim('left'))}${col(s.dim('right'))}  ${s.dim('change')}`
    );
    const L = result.left.summary;
    const R = result.right.summary;
    r.line(
        `   ${padEndVisible('Size', 10)}${col(r.bytes(L.bytes))}${col(r.bytes(R.bytes))}  ${signed(result.delta.bytes)}${pct(L.bytes, R.bytes)}`
    );
    r.line(
        `   ${padEndVisible('On disk', 10)}${col(r.bytes(L.diskBytes))}${col(r.bytes(R.diskBytes))}  ${signed(result.delta.diskBytes)}`
    );
    r.line(
        `   ${padEndVisible('Files', 10)}${col(formatCount(L.files))}${col(formatCount(R.files))}  ${signedCount(result.delta.files)}`
    );
    r.line(
        `   ${padEndVisible('Folders', 10)}${col(formatCount(L.directories))}${col(formatCount(R.directories))}  ${signedCount(result.delta.directories)}`
    );

    const changedTypes = CATEGORIES.filter(
        (c) =>
            result.left.types[c].bytes !== result.right.types[c].bytes ||
            result.left.types[c].files !== result.right.types[c].files
    );
    if (changedTypes.length > 0) {
        r.heading('By type');
        for (const c of changedTypes) {
            const l = result.left.types[c];
            const rt = result.right.types[c];
            r.line(
                `   ${padEndVisible(CATEGORY_LABELS[c], 10)}${col(r.bytes(l.bytes))}${col(r.bytes(rt.bytes))}  ${signed(rt.bytes - l.bytes)}  ${s.dim(`${signedCount(rt.files - l.files)} files`)}`
            );
        }
    }

    const fileSection = (title: string, list: ComparisonResult['added'], mark: string): void => {
        if (list.count === 0) return;
        r.heading(title, `${plural(list.count, 'file')} · ${r.bytes(list.bytes)}`);
        for (const f of list.items.slice(0, r.limit)) {
            r.line(
                `   ${mark} ${r.size(f.bytes)}  ${truncateMiddle(f.path, r.room(5 + SIZE_WIDTH + 2))}`
            );
        }
        r.more(Math.min(r.limit, list.items.length), list.count);
    };
    fileSection('Added', result.added, s.green('+'));
    fileSection('Removed', result.removed, s.red('-'));

    if (result.changed.count > 0) {
        r.heading(
            'Changed',
            `${plural(result.changed.count, 'file')} · ${formatBytes(result.changed.delta, r.units)} net`
        );
        for (const c of result.changed.items.slice(0, r.limit)) {
            const detail =
                c.delta === 0 ? 'content' : `${r.bytes(c.leftBytes)} → ${r.bytes(c.rightBytes)}`;
            r.line(
                `   ${s.yellow('~')} ${padStartVisible(signed(c.delta), SIZE_WIDTH)}  ${truncateMiddle(c.path, r.room(5 + SIZE_WIDTH + 4 + detail.length))}  ${s.dim(detail)}`
            );
        }
        r.more(Math.min(r.limit, result.changed.items.length), result.changed.count);
    }

    if (result.directories.length > 0) {
        r.heading('Folders that changed most');
        for (const d of result.directories.slice(0, r.limit)) {
            r.line(
                `   ${padStartVisible(signed(d.delta), SIZE_WIDTH + 2)}  ${truncateMiddle(`${d.path}/`, r.room(5 + SIZE_WIDTH + 2))}`
            );
        }
    }

    r.line('');
    const identical = result.added.count + result.removed.count + result.changed.count === 0;
    r.line(
        ` ${identical ? s.green('No differences.') : s.dim(`${plural(result.unchanged, 'file')} unchanged`)} ${s.dim(`(compared by ${result.mode === 'content' ? 'size and content' : 'size'})`)}`
    );
    r.line('');
    return r.lines.join('\n');
}
