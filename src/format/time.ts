/**
 * Date, age, and duration helpers used by filters, reports, and the CLI.
 */

const MS_PER_UNIT: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    min: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    mo: 2_629_746_000, // average Gregorian month
    y: 31_556_952_000, // average Gregorian year
};

const DURATION_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|min|mo|m|h|d|w|y)\s*$/i;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a duration such as `90d`, `2w`, `6mo`, `1y`, `12h`, or `30min` into milliseconds. */
export function parseDuration(input: string): number {
    const match = DURATION_PATTERN.exec(input);
    if (!match) {
        throw new RangeError(
            `Invalid duration "${input}". Use a number and a unit: s, min, h, d, w, mo, or y (for example 90d).`
        );
    }
    return Number(match[1]) * MS_PER_UNIT[match[2]!.toLowerCase()]!;
}

export interface PointInTimeOptions {
    /** Reference time for relative ages. Defaults to now. */
    now?: number;
    /**
     * For date-only input (`YYYY-MM-DD`), resolve to the last millisecond of
     * that local day instead of its first. Makes upper bounds inclusive.
     */
    endOfDay?: boolean;
}

/**
 * Resolves a point in time from either an age relative to now (`30d` means
 * "30 days ago") or an absolute date (`2024-01-31`, or any ISO 8601 timestamp).
 * Date-only values are interpreted in local time. Returns epoch milliseconds.
 */
export function parsePointInTime(input: string, options: PointInTimeOptions = {}): number {
    const now = options.now ?? Date.now();
    if (DURATION_PATTERN.test(input)) return now - parseDuration(input);

    const dateOnly = DATE_ONLY_PATTERN.exec(input.trim());
    if (dateOnly) {
        const [, y, m, d] = dateOnly;
        const date = new Date(Number(y), Number(m) - 1, Number(d));
        if (date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) {
            throw new RangeError(`Invalid date "${input}".`);
        }
        if (options.endOfDay) date.setHours(23, 59, 59, 999);
        return date.getTime();
    }

    const parsed = Date.parse(input);
    if (Number.isNaN(parsed)) {
        throw new RangeError(
            `Invalid date or age "${input}". Use YYYY-MM-DD, an ISO timestamp, or an age such as 30d.`
        );
    }
    return parsed;
}

/** Formats an elapsed duration compactly: `840ms`, `3.2s`, `2m 05s`. */
export function formatElapsed(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** Formats how long ago a timestamp was, using the largest whole unit: `3d`, `5mo`, `2y`. */
export function formatAge(timestampMs: number, now: number = Date.now()): string {
    const diff = Math.max(0, now - timestampMs);
    const units: Array<[string, number]> = [
        ['y', MS_PER_UNIT['y']!],
        ['mo', MS_PER_UNIT['mo']!],
        ['d', MS_PER_UNIT['d']!],
        ['h', MS_PER_UNIT['h']!],
        ['m', MS_PER_UNIT['m']!],
    ];
    for (const [label, size] of units) {
        if (diff >= size) return `${Math.floor(diff / size)}${label}`;
    }
    return 'now';
}
