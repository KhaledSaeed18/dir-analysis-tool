import type {
    ExplainGroup,
    ExplainNote,
    ExplainReason,
    PathExplanation,
    SkipsExplanation,
} from '../core/explain.ts';
import { formatBytes, type ByteUnits } from '../format/bytes.ts';
import { createStyle, type Style } from '../format/style.ts';
import { escapeControl, fitPath, formatCount, padEndVisible, plural } from '../format/text.ts';

export interface ExplainRenderOptions {
    style?: Style | undefined;
    units?: ByteUnits | undefined;
    /** Terminal width; long paths are shortened to fit. Default: 100. */
    width?: number | undefined;
}

const SETTING_FLAGS: Record<string, string> = {
    minSize: '--min-size',
    maxSize: '--max-size',
    modifiedAfter: '--newer-than',
    modifiedBefore: '--older-than',
    maxDepth: '--max-depth',
};

function flagOf(rule: string | null): string {
    return (rule && SETTING_FLAGS[rule]) ?? rule ?? '';
}

function sizeOf(value: number | string | null, units: ByteUnits): string {
    return typeof value === 'number' ? formatBytes(value, units) : String(value);
}

/** One-line description of a rule, as shown in both forms. */
function ruleLabel(
    group: Pick<ExplainGroup, 'source' | 'file' | 'line' | 'rule' | 'index' | 'limit'>,
    units: ByteUnits
): string {
    const rule = escapeControl(group.rule ?? '');
    switch (group.source) {
        case 'default':
            return `default exclude  ${rule}`;
        case 'pattern':
            return `exclude pattern ${(group.index ?? 0) + 1}  ${rule}`;
        case 'gitignore':
        case 'info-exclude':
            return `${escapeControl(group.file ?? '')}:${group.line}  ${rule}`;
        case 'size':
            return `${flagOf(group.rule)} ${sizeOf(group.limit, units)}`;
        case 'date':
            return `${flagOf(group.rule)} ${String(group.limit)}`;
        case 'max-depth':
            return `--max-depth ${String(group.limit)}`;
        case 'symlink':
            return 'symbolic links (not followed)';
        case 'special-file':
            return 'special files';
        case 'error':
            return 'unreadable';
        case 'unknown':
            return 'no single rule identified';
    }
}

function reasonLines(reason: ExplainReason, units: ByteUnits, s: Style): Array<[string, string]> {
    const rows: Array<[string, string]> = [];
    const at = escapeControl(reason.at || '.');
    if (reason.ancestor) rows.push(['Decided at', `${at} ${s.dim('(parent directory)')}`]);
    switch (reason.source) {
        case 'default':
            rows.push(['Rule', `default exclude ${escapeControl(reason.rule ?? '')}`]);
            rows.push(['Change it', 'use --all to include default excludes']);
            break;
        case 'pattern':
            rows.push([
                'Rule',
                `exclude pattern ${(reason.index ?? 0) + 1}  ${escapeControl(reason.rule ?? '')}`,
            ]);
            break;
        case 'gitignore':
        case 'info-exclude':
            rows.push([
                'Rule',
                `${escapeControl(reason.file ?? '')}:${reason.line}  ${escapeControl(reason.rule ?? '')}`,
            ]);
            break;
        case 'size':
            rows.push([
                'Rule',
                `${flagOf(reason.rule)} ${sizeOf(reason.limit, units)}; the file is ${sizeOf(reason.actual, units)} (${formatCount(Number(reason.actual))} bytes)`,
            ]);
            break;
        case 'date':
            rows.push([
                'Rule',
                `${flagOf(reason.rule)} ${String(reason.limit)}; modified ${String(reason.actual)}`,
            ]);
            break;
        case 'max-depth':
            rows.push([
                'Rule',
                `--max-depth ${String(reason.limit)}; ${at} is at depth ${String(reason.actual)}`,
            ]);
            break;
        case 'symlink':
            rows.push([
                'Rule',
                reason.code
                    ? `symbolic link to nothing (${reason.code}); counted, not followed`
                    : 'symbolic link; counted, not followed (use -L to follow)',
            ]);
            break;
        case 'special-file':
            rows.push(['Rule', 'special file (socket, FIFO, or device); never counted']);
            break;
        case 'error':
            rows.push(['Error', `${reason.code ?? 'UNKNOWN'}: could not read ${at}`]);
            break;
        case 'unknown':
            rows.push(['Rule', 'no single rule identified']);
            break;
    }
    return rows;
}

function noteText(note: ExplainNote): string {
    return escapeControl(note.message);
}

const HEADLINE: Record<PathExplanation['decision'], string> = {
    included: 'included',
    excluded: 'excluded',
    filtered: 'filtered',
    skipped: 'skipped',
    'not-found': 'not found',
};

/** Human-readable explanation of one path. */
export function renderPathExplanation(
    result: PathExplanation,
    options: ExplainRenderOptions = {}
): string {
    const s = options.style ?? createStyle(false);
    const units = options.units ?? 'iec';
    const paint = (text: string): string =>
        result.decision === 'included'
            ? s.green(text)
            : result.decision === 'not-found'
              ? s.yellow(text)
              : s.red(text);
    const shown = escapeControl(result.path || '.');
    const lines = [`${s.bold(shown)}: ${paint(HEADLINE[result.decision])}`, ''];
    const rows: Array<[string, string]> = [];
    if (result.reason) {
        rows.push(...reasonLines(result.reason, units, s));
        const unvisited =
            result.reason.ancestor ||
            (result.type === 'directory' &&
                (result.decision === 'excluded' || result.decision === 'skipped'));
        if (unvisited && result.reason.source !== 'symlink') {
            rows.push(['Inside it', 'not measured; dat never enters a directory it skips']);
        }
    } else if (result.decision === 'included') {
        rows.push(['Counted', 'yes, by a scan with these settings']);
    } else {
        rows.push(['Path', `nothing at ${shown} under ${escapeControl(result.root)}`]);
    }
    for (const note of result.notes) rows.push(['Note', noteText(note)]);
    const width = Math.max(...rows.map(([label]) => label.length));
    for (const [label, value] of rows) lines.push(`  ${s.dim(label.padEnd(width))}  ${value}`);
    return `${lines.join('\n')}\n`;
}

/** Human-readable summary of everything a scan left out. */
export function renderSkipsExplanation(
    result: SkipsExplanation,
    options: ExplainRenderOptions = {}
): string {
    const s = options.style ?? createStyle(false);
    const units = options.units ?? 'iec';
    const width = options.width ?? 100;
    const { totals } = result;
    const parts: string[] = [];
    if (totals.excluded > 0) parts.push(`${plural(totals.excluded, 'entry', 'entries')} excluded`);
    if (totals.filtered > 0) parts.push(`${plural(totals.filtered, 'file')} filtered`);
    if (totals.depthSkipped > 0) {
        parts.push(`${plural(totals.depthSkipped, 'directory', 'directories')} beyond --max-depth`);
    }
    const unfollowed = result.groups.find((g) => g.source === 'symlink')?.count ?? 0;
    if (unfollowed > 0) parts.push(`${plural(unfollowed, 'symbolic link')} not followed`);
    if (totals.errors > 0) parts.push(`${plural(totals.errors, 'entry', 'entries')} unreadable`);

    const lines: string[] = [];
    lines.push(
        parts.length > 0
            ? s.bold(`Skipped: ${parts.join(', ')}`)
            : s.bold('Nothing was skipped: every entry is counted.')
    );

    if (result.groups.length > 0) {
        lines.push('');
        const labels = result.groups.map((g) => ruleLabel(g, units));
        const labelWidth = Math.min(48, Math.max(...labels.map((l) => l.length)));
        const countWidth = Math.max(...result.groups.map((g) => formatCount(g.count).length));
        result.groups.forEach((group, i) => {
            lines.push(
                `  ${padEndVisible(labels[i]!, labelWidth)}  ${s.bold(formatCount(group.count).padStart(countWidth))}`
            );
            for (const entry of group.entries) lines.push(`      ${fitPath(entry, width - 6)}`);
            // With --limit 0 only counts were asked for, so there is nothing to apologize for.
            if (group.truncated && result.limit > 0) {
                const rest = group.count - group.entries.length;
                lines.push(
                    s.dim(
                        `      … and ${formatCount(rest)} more (raise --limit, up to 1000, to list more)`
                    )
                );
            }
        });
    }

    if (result.errors.length > 0) {
        lines.push('', `  ${s.yellow('Unreadable')}`);
        for (const error of result.errors) {
            lines.push(`      ${fitPath(error.path, width - 20)}  ${s.dim(error.code)}`);
        }
    }

    const notes = result.notes.map(noteText);
    if (result.groups.some((g) => g.source !== 'size' && g.source !== 'date')) {
        notes.push(
            'Sizes inside skipped directories are unknown. Measure one with: dat <dir> --all'
        );
    }
    if (notes.length > 0) {
        lines.push('');
        for (const note of notes) lines.push(s.dim(note));
    }
    return `${lines.join('\n')}\n`;
}
