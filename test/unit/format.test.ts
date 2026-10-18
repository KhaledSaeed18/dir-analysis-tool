import { describe, expect, it } from 'vitest';
import { formatBytes, parseSize } from '../../src/format/bytes.ts';
import { createStyle, stripAnsi, supportsColor } from '../../src/format/style.ts';
import { bar, formatPercent, plural, truncateMiddle, visibleWidth } from '../../src/format/text.ts';
import {
    formatAge,
    formatElapsed,
    parseDuration,
    parsePointInTime,
} from '../../src/format/time.ts';

describe('formatBytes', () => {
    it.each([
        [0, 'iec', '0 B'],
        [1023, 'iec', '1023 B'],
        [1024, 'iec', '1 KiB'],
        [1536, 'iec', '1.5 KiB'],
        [10 * 1024 * 1024, 'iec', '10 MiB'],
        [123.4 * 1024 ** 3, 'iec', '123 GiB'],
        [1000, 'si', '1 kB'],
        [1_234_567, 'si', '1.23 MB'],
        [-2048, 'iec', '-2 KiB'],
    ] as const)('formats %d (%s) as %s', (value, units, expected) => {
        expect(formatBytes(value, units)).toBe(expected);
    });

    it('promotes values that round up to the next unit', () => {
        expect(formatBytes(1024 * 1024 - 1)).toBe('1 MiB');
    });

    it('passes through non-finite values', () => {
        expect(formatBytes(Number.NaN)).toBe('NaN');
    });
});

describe('parseSize', () => {
    it.each([
        ['512', 512],
        ['10k', 10 * 1024],
        ['1.5M', 1.5 * 1024 ** 2],
        ['2GiB', 2 * 1024 ** 3],
        ['10kB', 10_000],
        ['500MB', 500_000_000],
        ['1 gb', 1_000_000_000],
        ['.5k', 512],
        ['7b', 7],
    ])('parses %s', (input, expected) => {
        expect(parseSize(input)).toBe(expected);
    });

    it('accepts non-negative numbers', () => {
        expect(parseSize(42.9)).toBe(42);
    });

    it.each(['', 'abc', '10 parsecs', '-5', '1e3'])('rejects %j', (input) => {
        expect(() => parseSize(input)).toThrow(RangeError);
    });

    it('rejects negative numbers', () => {
        expect(() => parseSize(-1)).toThrow(RangeError);
    });
});

describe('time', () => {
    const now = new Date(2026, 5, 15, 12, 0, 0).getTime();

    it('parses durations', () => {
        expect(parseDuration('90d')).toBe(90 * 86_400_000);
        expect(parseDuration('2w')).toBe(14 * 86_400_000);
        expect(parseDuration('30min')).toBe(30 * 60_000);
        expect(parseDuration('5m')).toBe(5 * 60_000);
        expect(parseDuration('1y')).toBeGreaterThan(365 * 86_400_000);
        expect(() => parseDuration('soon')).toThrow(RangeError);
    });

    it('resolves ages relative to now', () => {
        expect(parsePointInTime('1d', { now })).toBe(now - 86_400_000);
    });

    it('resolves dates in local time, optionally at the end of the day', () => {
        expect(parsePointInTime('2024-01-31', { now })).toBe(new Date(2024, 0, 31).getTime());
        expect(parsePointInTime('2024-01-31', { now, endOfDay: true })).toBe(
            new Date(2024, 0, 31, 23, 59, 59, 999).getTime()
        );
    });

    it('accepts ISO timestamps and rejects impossible dates', () => {
        expect(parsePointInTime('2024-01-31T10:00:00Z')).toBe(Date.parse('2024-01-31T10:00:00Z'));
        expect(() => parsePointInTime('2024-02-31')).toThrow(RangeError);
        expect(() => parsePointInTime('yesterday-ish')).toThrow(RangeError);
    });

    it('formats elapsed time and ages', () => {
        expect(formatElapsed(840)).toBe('840ms');
        expect(formatElapsed(3200)).toBe('3.2s');
        expect(formatElapsed(125_000)).toBe('2m 05s');
        expect(formatAge(now - 3 * 86_400_000, now)).toBe('3d');
        expect(formatAge(now - 400 * 86_400_000, now)).toBe('1y');
        expect(formatAge(now, now)).toBe('now');
    });
});

describe('style', () => {
    it('detects color support from the environment and the stream', () => {
        expect(supportsColor({ isTTY: true }, {})).toBe(true);
        expect(supportsColor({ isTTY: false }, {})).toBe(false);
        expect(supportsColor({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
        expect(supportsColor({ isTTY: true }, { TERM: 'dumb' })).toBe(false);
        expect(supportsColor({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
        expect(supportsColor({ isTTY: true }, { FORCE_COLOR: '0' })).toBe(false);
    });

    it('styles only when enabled', () => {
        expect(createStyle(false).red('x')).toBe('x');
        const styled = createStyle(true).red('x');
        expect(styled).not.toBe('x');
        expect(stripAnsi(styled)).toBe('x');
        expect(visibleWidth(createStyle(true).bold('abc'))).toBe(3);
    });
});

describe('text', () => {
    it('truncates in the middle, keeping the end', () => {
        expect(truncateMiddle('short', 10)).toBe('short');
        const result = truncateMiddle('src/very/long/path/to/some/file.ts', 20);
        expect(result).toHaveLength(20);
        expect(result).toContain('…');
        expect(result.endsWith('file.ts')).toBe(true);
    });

    it('draws bars of a fixed width', () => {
        expect(bar(0, 8)).toBe(' '.repeat(8));
        expect(bar(1, 8)).toBe('█'.repeat(8));
        expect(bar(0.5, 8)).toBe(`${'█'.repeat(4)}    `);
        expect(bar(Number.NaN, 4)).toHaveLength(4);
    });

    it('formats percentages and plurals', () => {
        expect(formatPercent(1, 1000)).toBe('<1%');
        expect(formatPercent(0, 0)).toBe('0%');
        expect(formatPercent(1, 4)).toBe('25%');
        expect(plural(1, 'file')).toBe('1 file');
        expect(plural(1200, 'file')).toBe('1,200 files');
        expect(plural(2, 'entry', 'entries')).toBe('2 entries');
    });
});
