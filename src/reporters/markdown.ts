import { formatBudgetActual } from '../core/budgets.ts';
import { formatBytes, unitsOf, type ByteUnits } from '../format/bytes.ts';
import { formatCount, formatPercent, plural } from '../format/text.ts';
import {
    CATEGORIES,
    type AnalysisResult,
    type ComparisonResult,
    type FileEntry,
} from '../types.ts';

export interface MarkdownOptions {
    units?: ByteUnits;
    /** Maximum rows per table. Default: 10. */
    limit?: number;
}

/** Inline code that is safe inside a GitHub table cell. */
export function mdCode(text: string): string {
    const fence = text.includes('`') ? '``' : '`';
    const padded = fence === '``' ? ` ${text} ` : text;
    return `${fence}${padded.replaceAll('|', '\\|')}${fence}`;
}

function table(header: string[], rows: string[][], align?: Array<'l' | 'r'>): string[] {
    const sep = header.map((_, i) => (align?.[i] === 'r' ? '---:' : '---'));
    return [
        `| ${header.join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
        ...rows.map((r) => `| ${r.join(' | ')} |`),
    ];
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Renders an analysis as GitHub-flavored Markdown, suited to PR comments and job summaries. */
export function renderAnalysisMarkdown(
    result: AnalysisResult,
    options: MarkdownOptions = {}
): string {
    const units = options.units ?? 'iec';
    const limit = options.limit ?? 10;
    const b = (n: number): string => formatBytes(n, units);
    const sum = result.summary;
    const out: string[] = [];
    const more = (shown: number, total: number): void => {
        if (total > shown) out.push('', `<sub>…and ${formatCount(total - shown)} more</sub>`);
    };
    const fileTable = (items: FileEntry[], total: number): void => {
        const shown = items.slice(0, limit);
        out.push(
            ...table(
                ['Size', 'Path'],
                shown.map((f) => [b(f.bytes), mdCode(f.path)]),
                ['r', 'l']
            )
        );
        more(shown.length, total);
    };

    out.push(`## Directory analysis: ${mdCode(result.root)}`, '');
    out.push(
        ...table(
            ['Metric', 'Value'],
            [
                [
                    'Size',
                    `**${b(sum.bytes)}**${sum.diskBytes !== sum.bytes ? ` (${b(sum.diskBytes)} on disk)` : ''}`,
                ],
                ['Files', formatCount(sum.files)],
                ['Folders', formatCount(sum.directories)],
                ...(sum.excluded > 0 ? [['Excluded', formatCount(sum.excluded)]] : []),
                ...(sum.errors > 0 ? [['Unreadable', formatCount(sum.errors)]] : []),
            ],
            ['l', 'r']
        )
    );

    if (result.budgets && result.budgets.length > 0) {
        const failed = result.budgets.filter((x) => !x.passed).length;
        out.push('', `### Budgets ${failed > 0 ? `❌ ${failed} failed` : '✅ all passed'}`, '');
        out.push(
            ...table(
                ['', 'Rule', 'Actual'],
                result.budgets.map((x) => [
                    x.passed ? '✅' : '❌',
                    mdCode(x.rule),
                    formatBudgetActual(x, units),
                ])
            )
        );
    }

    const types = CATEGORIES.filter((c) => result.types[c].files > 0).sort(
        (x, y) => result.types[y].bytes - result.types[x].bytes
    );
    if (types.length > 0) {
        out.push('', '### File types', '');
        out.push(
            ...table(
                ['Type', 'Size', 'Share', 'Files'],
                types.map((c) => [
                    capitalize(c),
                    b(result.types[c].bytes),
                    formatPercent(result.types[c].bytes, sum.bytes),
                    formatCount(result.types[c].files),
                ]),
                ['l', 'r', 'r', 'r']
            )
        );
    }

    if (result.largestDirectories.length > 0) {
        out.push('', '### Largest folders', '');
        out.push(
            ...table(
                ['Size', 'Folder', 'Files'],
                result.largestDirectories
                    .slice(0, limit)
                    .map((d) => [b(d.bytes), mdCode(`${d.path}/`), formatCount(d.files)]),
                ['r', 'l', 'r']
            )
        );
    }
    if (result.largestFiles.length > 0) {
        out.push('', '### Largest files', '');
        fileTable(result.largestFiles, result.largestFiles.length);
    }
    if (result.largeFiles && result.largeFiles.count > 0) {
        const lf = result.largeFiles;
        out.push(
            '',
            `### Large files (≥ ${formatBytes(lf.threshold, unitsOf(lf.threshold, units))}): ${plural(lf.count, 'file')}, ${b(lf.bytes)}`,
            ''
        );
        fileTable(lf.items, lf.count);
    }
    if (result.duplicates) {
        const d = result.duplicates;
        out.push(
            '',
            `### Duplicates: ${plural(d.count, 'group')}, ${b(d.wastedBytes)} reclaimable`
        );
        if (d.count > 0) {
            out.push('');
            const shown = d.items.slice(0, limit);
            out.push(
                ...table(
                    ['Reclaimable', 'Copies', 'Files'],
                    shown.map((g) => [
                        b(g.wastedBytes),
                        `${g.files.length} × ${b(g.bytes)}`,
                        g.files.slice(0, 5).map(mdCode).join('<br>') +
                            (g.files.length > 5 ? `<br>…${g.files.length - 5} more` : ''),
                    ]),
                    ['r', 'r', 'l']
                )
            );
            more(shown.length, d.count);
        }
    }
    if (result.emptyFiles && result.emptyFiles.count > 0) {
        out.push('', `### Empty files: ${formatCount(result.emptyFiles.count)}`, '');
        for (const f of result.emptyFiles.items.slice(0, limit)) out.push(`- ${mdCode(f.path)}`);
        more(Math.min(limit, result.emptyFiles.items.length), result.emptyFiles.count);
    }
    if (result.emptyDirectories && result.emptyDirectories.count > 0) {
        out.push('', `### Empty folders: ${formatCount(result.emptyDirectories.count)}`, '');
        for (const d of result.emptyDirectories.items.slice(0, limit)) {
            out.push(`- ${mdCode(`${d}/`)}`);
        }
        more(Math.min(limit, result.emptyDirectories.items.length), result.emptyDirectories.count);
    }
    if (result.staleFiles && result.staleFiles.count > 0) {
        const sf = result.staleFiles;
        out.push(
            '',
            `### Not modified since ${sf.modifiedBefore.slice(0, 10)}: ${plural(sf.count, 'file')}, ${b(sf.bytes)}`,
            ''
        );
        fileTable(sf.items, sf.count);
    }

    out.push(
        '',
        `<sub>Generated by [dir-analysis-tool](https://github.com/KhaledSaeed18/dir-analysis-tool) v${result.tool.version}</sub>`,
        ''
    );
    return out.join('\n');
}

/** Renders a directory comparison as GitHub-flavored Markdown. */
export function renderComparisonMarkdown(
    result: ComparisonResult,
    options: MarkdownOptions = {}
): string {
    const units = options.units ?? 'iec';
    const limit = options.limit ?? 10;
    const b = (n: number): string => formatBytes(n, units);
    const signed = (n: number): string => (n > 0 ? `+${b(n)}` : n < 0 ? b(n) : '±0');
    const signedCount = (n: number): string => (n > 0 ? `+${formatCount(n)}` : formatCount(n));
    const L = result.left.summary;
    const R = result.right.summary;
    const out: string[] = [];

    out.push(
        `## Directory comparison`,
        '',
        `**Left:** ${mdCode(result.left.root)}  `,
        `**Right:** ${mdCode(result.right.root)}`,
        ''
    );
    out.push(
        ...table(
            ['', 'Left', 'Right', 'Change'],
            [
                ['Size', b(L.bytes), b(R.bytes), `**${signed(result.delta.bytes)}**`],
                ['On disk', b(L.diskBytes), b(R.diskBytes), signed(result.delta.diskBytes)],
                [
                    'Files',
                    formatCount(L.files),
                    formatCount(R.files),
                    signedCount(result.delta.files),
                ],
                [
                    'Folders',
                    formatCount(L.directories),
                    formatCount(R.directories),
                    signedCount(result.delta.directories),
                ],
            ],
            ['l', 'r', 'r', 'r']
        )
    );

    const section = (title: string, list: ComparisonResult['added']): void => {
        if (list.count === 0) return;
        out.push('', `### ${title}: ${plural(list.count, 'file')}, ${b(list.bytes)}`, '');
        out.push(
            ...table(
                ['Size', 'Path'],
                list.items.slice(0, limit).map((f) => [b(f.bytes), mdCode(f.path)]),
                ['r', 'l']
            )
        );
        if (list.count > limit) {
            out.push('', `<sub>…and ${formatCount(list.count - limit)} more</sub>`);
        }
    };
    section('Added', result.added);
    section('Removed', result.removed);
    if (result.changed.count > 0) {
        out.push(
            '',
            `### Changed: ${plural(result.changed.count, 'file')}, ${signed(result.changed.delta)} net`,
            ''
        );
        out.push(
            ...table(
                ['Change', 'Path', 'Left', 'Right'],
                result.changed.items
                    .slice(0, limit)
                    .map((c) => [signed(c.delta), mdCode(c.path), b(c.leftBytes), b(c.rightBytes)]),
                ['r', 'l', 'r', 'r']
            )
        );
        if (result.changed.count > limit) {
            out.push('', `<sub>…and ${formatCount(result.changed.count - limit)} more</sub>`);
        }
    }
    if (result.directories.length > 0) {
        out.push('', '### Folders that changed most', '');
        out.push(
            ...table(
                ['Change', 'Folder'],
                result.directories
                    .slice(0, limit)
                    .map((d) => [signed(d.delta), mdCode(`${d.path}/`)]),
                ['r', 'l']
            )
        );
    }
    out.push(
        '',
        `<sub>${plural(result.unchanged, 'file')} unchanged, compared by ${result.mode === 'content' ? 'size and content' : 'size'}. Generated by [dir-analysis-tool](https://github.com/KhaledSaeed18/dir-analysis-tool) v${result.tool.version}</sub>`,
        ''
    );
    return out.join('\n');
}
