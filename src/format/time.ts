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
/** `YYYY-MM-DDTHH:mm`, with optional seconds and fraction, and an optional `Z` or `±HH:mm` offset. */
const TIMESTAMP_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))?$/i;
const BARE_NUMBER_PATTERN = /^\d+(?:\.\d+)?$/;
const LOOSE_DATE_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

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
 * "30 days ago") or an absolute date: `YYYY-MM-DD` in local time, or an ISO
 * 8601 timestamp such as `2024-01-31T10:00:00Z` (local time without an
 * offset). Anything else throws a `RangeError`, including bare numbers, which
 * have no unit. Returns epoch milliseconds.
 */
export function parsePointInTime(input: string, options: PointInTimeOptions = {}): number {
    const now = options.now ?? Date.now();
    if (DURATION_PATTERN.test(input)) return now - parseDuration(input);
    const text = input.trim();

    const dateOnly = DATE_ONLY_PATTERN.exec(text);
    if (dateOnly) {
        const [, y, m, d] = dateOnly;
        if (!isCalendarDate(Number(y), Number(m), Number(d))) {
            throw new RangeError(`Invalid date "${input}".`);
        }
        const date = new Date(2000, Number(m) - 1, Number(d));
        date.setFullYear(Number(y)); // the Date constructor reads years 0 to 99 as 1900 to 1999
        if (options.endOfDay) date.setHours(23, 59, 59, 999);
        return date.getTime();
    }

    const timestamp = TIMESTAMP_PATTERN.exec(text);
    if (timestamp) {
        const [, y, m, d, hour, minute, second = '0', offsetHours = '0', offsetMinutes = '0'] =
            timestamp;
        const parsed = Date.parse(text.toUpperCase());
        if (
            !isCalendarDate(Number(y), Number(m), Number(d)) ||
            Number(hour) > 23 ||
            Number(minute) > 59 ||
            Number(second) > 59 ||
            Number(offsetHours) > 23 ||
            Number(offsetMinutes) > 59 ||
            Number.isNaN(parsed)
        ) {
            throw new RangeError(`Invalid timestamp "${input}".`);
        }
        return parsed;
    }

    if (/^\d{4}$/.test(text) && Number(text) >= 1900) {
        throw new RangeError(
            `Invalid date or age "${input}". For a date, write YYYY-MM-DD, for example ${text}-01-01; for an age, add a unit, for example 30d.`
        );
    }
    if (BARE_NUMBER_PATTERN.test(text)) {
        throw new RangeError(
            `Invalid date or age "${input}": an age needs a unit. Add one, for example ${text}mo (months) or ${text}d (days).`
        );
    }
    if (TIMESTAMP_PATTERN.test(text.replace(' ', 'T'))) {
        throw new RangeError(
            `Invalid timestamp "${input}". Separate the date and the time with T, for example ${text.replace(' ', 'T')}.`
        );
    }
    const loose = LOOSE_DATE_PATTERN.exec(text);
    if (loose) {
        const [, y, m, d] = loose;
        throw new RangeError(
            `Invalid date "${input}". Write dates as YYYY-MM-DD, for example ${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}.`
        );
    }
    throw new RangeError(
        `Invalid date or age "${input}". Use an age such as 30d, a date as YYYY-MM-DD, or an ISO 8601 timestamp such as 2024-01-31T10:00:00Z.`
    );
}

/** True for a real day of the Gregorian calendar (no February 30). */
function isCalendarDate(year: number, month: number, day: number): boolean {
    const date = new Date(Date.UTC(2000, month - 1, day));
    date.setUTCFullYear(year);
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
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
