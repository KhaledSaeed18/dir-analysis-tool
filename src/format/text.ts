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

/* oxlint-disable no-control-regex -- matching control characters is the purpose of these patterns. */
/** C0 and C1 controls, DEL, Unicode line separators, and bidirectional overrides. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/** The same, without tab, CR, and LF, which CSV can carry inside a quoted cell. */
const CONTROL_EXCEPT_WHITESPACE =
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/** What `JSON.stringify` leaves raw but a terminal could still act on. */
const JSON_UNSAFE = /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/* oxlint-enable no-control-regex */

const NAMED_ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

function hexEscape(c: string): string {
    const code = c.charCodeAt(0);
    return code <= 0xff
        ? `\\x${code.toString(16).padStart(2, '0')}`
        : `\\u${code.toString(16).padStart(4, '0')}`;
}

function controlEscape(c: string): string {
    return NAMED_ESCAPES[c] ?? hexEscape(c);
}

/**
 * Makes untrusted text, such as a file name, safe to print: control characters
 * become visible escapes (`\x1b`, `\n`), so a name cannot drive the terminal,
 * forge report lines, or disguise itself. Backslashes are left alone because
 * Windows paths are full of them, so use JSON output for the exact name.
 */
export function escapeControl(text: string): string {
    return text.replace(CONTROL, controlEscape);
}

/** {@link escapeControl} for cells of a format that can quote tabs and line breaks. */
export function escapeControlKeepingWhitespace(text: string): string {
    return text.replace(CONTROL_EXCEPT_WHITESPACE, controlEscape);
}

/** {@link escapeControl} for a multi-line message: its own line breaks are kept. */
export function escapeControlInLines(text: string): string {
    return text.split('\n').map(escapeControl).join('\n');
}

/** Fits a name into `max` columns. Escapes first, so an escape is counted and never cut raw. */
export function fitPath(text: string, max: number): string {
    return truncateMiddle(escapeControl(text), max);
}

/**
 * `JSON.stringify` that also writes terminal-sensitive characters as `\uXXXX`.
 * Parsing the output gives back exactly the same strings.
 */
export function stringifyJson(value: unknown, indent?: number): string {
    return JSON.stringify(value, null, indent).replace(
        JSON_UNSAFE,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
    );
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
