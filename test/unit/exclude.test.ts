import { describe, expect, it } from 'vitest';
import { Excluder } from '../../src/core/exclude.ts';

describe('Excluder', () => {
    it('skips default directories unless turned off', () => {
        const on = new Excluder({ ignoreCase: false });
        const off = new Excluder({ defaultExcludes: false, ignoreCase: false });
        expect(on.isExcluded('a/node_modules', 'node_modules', true, [])).toBe(true);
        expect(on.isExcluded('.git', '.git', true, [])).toBe(true);
        expect(on.isExcluded('node_modules', 'node_modules', false, [])).toBe(false); // a file, not a dir
        expect(off.isExcluded('node_modules', 'node_modules', true, [])).toBe(false);
        expect(off.active).toBe(false);
        expect(on.needsPaths).toBe(false);
    });

    it('applies gitignore-style user patterns', () => {
        const ex = new Excluder({
            patterns: ['*.log', 'build/', 'docs/**/*.pdf', '!keep.log', ' '],
            ignoreCase: false,
        });
        expect(ex.needsPaths).toBe(true);
        expect(ex.isExcluded('app.log', 'app.log', false, [])).toBe(true);
        expect(ex.isExcluded('deep/app.log', 'app.log', false, [])).toBe(true);
        expect(ex.isExcluded('keep.log', 'keep.log', false, [])).toBe(false);
        expect(ex.isExcluded('build', 'build', true, [])).toBe(true);
        expect(ex.isExcluded('build', 'build', false, [])).toBe(false); // dir-only pattern
        expect(ex.isExcluded('docs/a/b.pdf', 'b.pdf', false, [])).toBe(true);
        expect(ex.isExcluded('b.pdf', 'b.pdf', false, [])).toBe(false);
    });

    it('honors case sensitivity', () => {
        const sensitive = new Excluder({ patterns: ['Build/'], ignoreCase: false });
        const insensitive = new Excluder({ patterns: ['Build/'], ignoreCase: true });
        expect(sensitive.isExcluded('build', 'build', true, [])).toBe(false);
        expect(insensitive.isExcluded('build', 'build', true, [])).toBe(true);
    });

    it('checks every ancestor of a watched path', () => {
        const ex = new Excluder({ patterns: ['tmp/', '*.swp'], ignoreCase: false });
        expect(ex.isPathExcluded('node_modules/x/index.js')).toBe(true);
        expect(ex.isPathExcluded('src/tmp/file.txt')).toBe(true);
        expect(ex.isPathExcluded('src/.main.ts.swp')).toBe(true);
        expect(ex.isPathExcluded('src/node_modules')).toBe(true);
        expect(ex.isPathExcluded('src/main.ts')).toBe(false);
        expect(ex.isPathExcluded('')).toBe(false);
    });
});
