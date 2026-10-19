/**
 * Byte formatting and parsing.
 *
 * Two unit systems are supported:
 * - `iec` (default): powers of 1024 with unambiguous IEC labels (KiB, MiB, GiB, …).
 * - `si`: powers of 1000 with SI labels (kB, MB, GB, …), matching most file managers.
 */

export type ByteUnits = 'iec' | 'si';

const IEC_LABELS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'] as const;
const SI_LABELS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB'] as const;

/**
 * Formats a byte count for humans, keeping three significant digits
 * (`1.23 MiB`, `12.3 MiB`, `123 MiB`). Negative values keep their sign,
 * which is useful for deltas.
 */
export function formatBytes(bytes: number, units: ByteUnits = 'iec'): string {
    if (!Number.isFinite(bytes)) return String(bytes);
    const sign = bytes < 0 ? '-' : '';
    let value = Math.abs(bytes);
    const base = units === 'si' ? 1000 : 1024;
    const labels = units === 'si' ? SI_LABELS : IEC_LABELS;

    let index = 0;
    while (value >= base && index < labels.length - 1) {
        value /= base;
        index++;
    }
    if (index === 0) return `${sign}${value} B`;

    // Rounding can push a value to the next unit (1023.96 KiB -> "1024 KiB").
    let digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    let rounded = Number(value.toFixed(digits));
    if (rounded >= base && index < labels.length - 1) {
        index++;
        rounded = 1;
        digits = 2;
    }
    return `${sign}${trimZeros(rounded.toFixed(digits))} ${labels[index]}`;
}

function trimZeros(text: string): string {
    return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/**
 * The unit system a byte count was most likely written in, so a value can be
 * shown back the way the user typed it: 1,000,000 bytes ("1MB") is SI and
 * 1,048,576 ("1MiB") is IEC. Returns `fallback` when it is ambiguous.
 */
export function unitsOf(bytes: number, fallback: ByteUnits): ByteUnits {
    if (!(bytes > 0)) return fallback;
    const si = bytes % 1000 === 0;
    const iec = bytes % 1024 === 0;
    if (si && !iec) return 'si';
    if (iec && !si) return 'iec';
    return fallback;
}

const SIZE_PATTERN = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([a-z]*)\s*$/i;

const SIZE_MULTIPLIERS: Record<string, number> = {
    '': 1,
    b: 1,
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
    p: 1024 ** 5,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
    pib: 1024 ** 5,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    pb: 1000 ** 5,
};

/**
 * Parses a human size into bytes.
 *
 * - Plain numbers are bytes: `4096`.
 * - Single letters and IEC suffixes are binary: `10k`, `1.5M`, `2GiB`.
 * - Two-letter SI suffixes are decimal: `10kB`, `500MB`, `1GB`.
 *
 * Suffixes are case-insensitive. Throws a `RangeError` for anything else.
 */
export function parseSize(input: string | number): number {
    if (typeof input === 'number') {
        if (Number.isFinite(input) && input >= 0) return Math.floor(input);
        throw new RangeError(`Invalid size: ${input}`);
    }
    const match = SIZE_PATTERN.exec(input);
    const multiplier = match ? SIZE_MULTIPLIERS[match[2]!.toLowerCase()] : undefined;
    if (!match || multiplier === undefined) {
        throw new RangeError(
            `Invalid size "${input}". Use bytes or a unit, for example 512, 10k, 25MiB, or 1GB.`
        );
    }
    return Math.floor(Number(match[1]) * multiplier);
}
