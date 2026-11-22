import { describe, expect, it } from 'vitest';
import { normalizeArgv } from '../../src/cli/argv.ts';

describe('normalizeArgv', () => {
    it('keeps valid values of optional-value flags', () => {
        expect(normalizeArgv(['-l', '50MB', '.'])).toEqual(['-l', '50MB', '.']);
        expect(normalizeArgv(['--stale', '2y'])).toEqual(['--stale', '2y']);
        expect(normalizeArgv(['--html', 'out.html'])).toEqual(['--html', 'out.html']);
        expect(normalizeArgv(['--csv', 'a.CSV'])).toEqual(['--csv', 'a.CSV']);
    });

    it('does not let an optional-value flag swallow the directory', () => {
        expect(normalizeArgv(['-l', './photos'])).toEqual(['--large-files=', './photos']);
        expect(normalizeArgv(['--stale', 'src'])).toEqual(['--stale=', 'src']);
        expect(normalizeArgv(['--html', '.'])).toEqual(['--html=', '.']);
        expect(normalizeArgv(['--csv', 'dir'])).toEqual(['--csv=', 'dir']);
    });

    it('keeps a number after --stale attached, so it is reported as a value without a unit', () => {
        expect(normalizeArgv(['--stale', '12', 'photos'])).toEqual(['--stale', '12', 'photos']);
        expect(normalizeArgv(['--stale', '2024-1-5'])).toEqual(['--stale', '2024-1-5']);
    });

    it('leaves flags followed by options, and everything after --, untouched', () => {
        expect(normalizeArgv(['-l', '-d'])).toEqual(['-l', '-d']);
        expect(normalizeArgv(['-l'])).toEqual(['-l']);
        expect(normalizeArgv(['--', '-l', 'x'])).toEqual(['--', '-l', 'x']);
    });
});
