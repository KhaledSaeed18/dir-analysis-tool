import { stripAnsi } from './style.ts';

/** Visible width of a string, ignoring ANSI escapes. */
export function visibleWidth(text: string): number {
    return stripAnsi(text).length;
}

export function padEndVisible(text: string, width: number): string {
    return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

export function padStartVisible(text: string, width: number): string {
    return ' '.repeat(Math.max(0, width - visibleWidth(text))) + text;
}

/**
 * Shortens text to `max` characters by replacing its middle with an ellipsis.
 * Paths keep their most informative parts: the start and the file name.
 */
export function truncateMiddle(text: string, max: number): string {
    if (text.length <= max) return text;
    if (max <= 1) return '…'.slice(0, max);
    const keepEnd = Math.ceil((max - 1) * 0.6);
    const keepStart = max - 1 - keepEnd;
    return `${text.slice(0, keepStart)}…${text.slice(text.length - keepEnd)}`;
}

const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const;

/** Renders a horizontal bar for `fraction` (0..1) using eighth-block characters. */
export function bar(fraction: number, width: number): string {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
    const eighths = Math.round(clamped * width * 8);
    const full = Math.floor(eighths / 8);
    const partial = PARTIAL_BLOCKS[eighths % 8]!;
    const used = full + (partial ? 1 : 0);
    return '█'.repeat(full) + partial + ' '.repeat(Math.max(0, width - used));
}

export function formatCount(value: number): string {
    return value.toLocaleString('en-US');
}

export function formatPercent(part: number, total: number): string {
    if (total <= 0) return '0%';
    const pct = (part / total) * 100;
    if (pct > 0 && pct < 1) return '<1%';
    return `${Math.round(pct)}%`;
}

export function plural(
    count: number,
    singular: string,
    pluralForm: string = `${singular}s`
): string {
    return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}
