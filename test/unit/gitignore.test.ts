import { describe, expect, it } from 'vitest';
import { GitignoreMatcher, parseRule } from '../../src/core/gitignore.ts';

function matcher(lines: string | readonly string[], ignoreCase = false): GitignoreMatcher {
    return GitignoreMatcher.compile(lines, { ignoreCase });
}

/** Git's view of a path: ignored when the path or any ancestor directory matches. */
function ignored(m: GitignoreMatcher, path: string, isDirectory = false): boolean {
    const segments = path.split('/');
    for (let i = 1; i <= segments.length; i++) {
        const sub = segments.slice(0, i).join('/');
        if (m.test(sub, i < segments.length || isDirectory) === true) return true;
    }
    return false;
}

describe('GitignoreMatcher', () => {
    it('matches bare wildcard rules and preserves negation and directory-only behavior', () => {
        for (const pattern of ['*', '**', '***', '**/*']) {
            const m = matcher([pattern, '!keep.txt']);
            expect(m.test('file.txt', false)).toBe(true);
            expect(m.test('.hidden', false)).toBe(true);
            expect(m.test('nested/file.txt', false)).toBe(true);
            expect(m.test('folder', true)).toBe(true);
            expect(m.test('keep.txt', false)).toBe(false);
        }
        for (const pattern of ['*/', '**/']) {
            const m = matcher(pattern);
            expect(m.test('folder', true)).toBe(true);
            expect(m.test('file.txt', false)).toBeUndefined();
        }
    });

    it('skips blank lines and comments, but keeps escaped # and !', () => {
        const m = matcher(['', '   ', '# comment', '\\#literal', '\\!bang']);
        expect(m.hasRules).toBe(true);
        expect(m.test('#literal', false)).toBe(true);
        expect(m.test('!bang', false)).toBe(true);
        expect(m.test('# comment', false)).toBeUndefined();
        expect(matcher(['', '#only']).hasRules).toBe(false);
        expect(matcher('').hasRules).toBe(false);
    });

    it('ignores trailing spaces unless escaped', () => {
        const m = matcher(['name   ', 'trail\\ ']);
        expect(m.test('name', false)).toBe(true);
        expect(m.test('trail ', false)).toBe(true);
        expect(m.test('trail', false)).toBeUndefined();
    });

    it('matches names at any depth when the pattern has no slash', () => {
        const m = matcher(['*.log', 'build', 'Makefile']);
        expect(ignored(m, 'app.log')).toBe(true);
        expect(ignored(m, 'a/b/app.log')).toBe(true);
        expect(ignored(m, 'build')).toBe(true);
        expect(ignored(m, 'build', true)).toBe(true);
        expect(ignored(m, 'src/build/out.js')).toBe(true);
        expect(ignored(m, 'x/Makefile')).toBe(true);
        expect(ignored(m, 'Makefile.in')).toBe(false);
        expect(ignored(m, 'logs/app.txt')).toBe(false);
    });

    it('anchors patterns that contain a slash', () => {
        const m = matcher(['/root.txt', 'src/*.ts', 'docs/**/*.pdf', 'a/**', '**/b/c']);
        expect(ignored(m, 'root.txt')).toBe(true);
        expect(ignored(m, 'deep/root.txt')).toBe(false);
        expect(ignored(m, 'src/a.ts')).toBe(true);
        expect(ignored(m, 'src/x/a.ts')).toBe(false);
        expect(ignored(m, 'lib/src/a.ts')).toBe(false);
        expect(ignored(m, 'docs/b.pdf')).toBe(true);
        expect(ignored(m, 'docs/x/y/b.pdf')).toBe(true);
        expect(ignored(m, 'b.pdf')).toBe(false);
        expect(ignored(m, 'a/anything/here')).toBe(true);
        expect(ignored(m, 'a', true)).toBe(false);
        expect(ignored(m, 'b/c')).toBe(true);
        expect(ignored(m, 'x/y/b/c')).toBe(true);
        expect(ignored(m, 'x/c')).toBe(false);
    });

    it('applies directory-only rules to directories (and everything inside)', () => {
        const m = matcher(['build/', 'tmp//']);
        expect(m.test('build', false)).toBeUndefined();
        expect(m.test('build', true)).toBe(true);
        expect(ignored(m, 'build/out.js')).toBe(true);
        expect(m.test('tmp', true)).toBe(true);
        expect(matcher(['/']).hasRules).toBe(false);
        expect(matcher(['!']).hasRules).toBe(false);
    });

    it('lets later rules override earlier ones, including negation', () => {
        const m = matcher(['*.log', '!keep.log', 'keep.log', '!*.log', 'last.log']);
        expect(m.test('keep.log', false)).toBe(false);
        expect(m.test('other.log', false)).toBe(false);
        expect(m.test('last.log', false)).toBe(true);
        expect(m.test('notes.txt', false)).toBeUndefined();
    });

    it('treats * and ? as single-segment wildcards and ** as any depth', () => {
        const m = matcher(['file?.txt', 'x**y', 'lib/**/test', 'foo/**', '**/*.bak']);
        expect(m.test('file1.txt', false)).toBe(true);
        expect(m.test('file12.txt', false)).toBeUndefined(); // `?` is exactly one character
        expect(m.test('file.txt', false)).toBeUndefined();
        expect(m.test('xy', false)).toBe(true);
        expect(m.test('x/y', false)).toBeUndefined(); // ** inside a segment acts like *
        expect(m.test('lib/test', false)).toBe(true);
        expect(m.test('lib/a/b/test', false)).toBe(true);
        expect(m.test('foo/bar/baz', false)).toBe(true);
        expect(m.test('foo', true)).toBeUndefined();
        expect(m.test('deep/down/x.bak', false)).toBe(true);
    });

    it('supports character classes, ranges, negation, and POSIX classes', () => {
        const m = matcher([
            '*.[ch]',
            'q[uv]ick',
            '[a-c]*.txt',
            'n[!0-9]',
            'd[[:digit:]]',
            '[]x]',
            '[^-]z',
        ]);
        expect(m.test('a.c', false)).toBe(true);
        expect(m.test('a.h', false)).toBe(true);
        expect(m.test('a.d', false)).toBeUndefined();
        expect(m.test('quick', false)).toBe(true);
        expect(m.test('qwick', false)).toBeUndefined();
        expect(m.test('b1.txt', false)).toBe(true);
        expect(m.test('d1.txt', false)).toBeUndefined();
        expect(m.test('na', false)).toBe(true);
        expect(m.test('n5', false)).toBeUndefined();
        expect(m.test('d7', false)).toBe(true);
        expect(m.test('dx', false)).toBeUndefined();
        expect(m.test(']', false)).toBe(true);
        expect(m.test('x', false)).toBe(true);
        expect(m.test('az', false)).toBe(true);
        expect(m.test('-z', false)).toBeUndefined();
    });

    it('treats unusable brackets literally and ignores unknown POSIX classes', () => {
        const m = matcher(['[abc', 'a[/]b', '[[:nope:]]']);
        expect(m.test('[abc', false)).toBe(true);
        expect(m.test('a', false)).toBeUndefined();
        expect(m.test('a[/]b', false)).toBe(true); // literal brackets around the slash
        expect(m.test('[[:nope:]]', false)).toBeUndefined();
    });

    it('honors backslash escapes', () => {
        const m = matcher(['esc\\ aped', 'star\\*', 'q\\?', 'back\\\\slash', 'end\\']);
        expect(m.test('esc aped', false)).toBe(true);
        expect(m.test('star*', false)).toBe(true);
        expect(m.test('starx', false)).toBeUndefined();
        expect(m.test('q?', false)).toBe(true);
        expect(m.test('back\\slash', false)).toBe(true);
        expect(m.test('end\\', false)).toBe(true);
    });

    it('matches case-insensitively when asked', () => {
        const sensitive = matcher(['Build/', '*.LOG', 'README']);
        const insensitive = matcher(['Build/', '*.LOG', 'README'], true);
        expect(sensitive.test('build', true)).toBeUndefined();
        expect(insensitive.test('build', true)).toBe(true);
        expect(sensitive.test('app.log', false)).toBeUndefined();
        expect(insensitive.test('app.log', false)).toBe(true);
        expect(insensitive.test('readme', false)).toBe(true);
        expect(insensitive.test('x/ReadMe', false)).toBe(true);
    });

    it('accepts a whole file as one string', () => {
        const m = matcher('# deps\r\nnode_modules/\r\n*.tmp\n\n!keep.tmp\n');
        expect(m.test('node_modules', true)).toBe(true);
        expect(m.test('node_modules', false)).toBeUndefined();
        expect(m.test('a.tmp', false)).toBe(true);
        expect(m.test('keep.tmp', false)).toBe(false);
    });

    it('describes rules for the fast path', () => {
        expect(parseRule('*.o')).toMatchObject({
            nameOnly: true,
            fast: { kind: 'suffix', value: '.o' },
        });
        expect(parseRule('Makefile')).toMatchObject({
            fast: { kind: 'literal', value: 'Makefile' },
        });
        expect(parseRule('*.[ch]')).toMatchObject({ nameOnly: true, fast: null });
        expect(parseRule('src/*.o')).toMatchObject({ nameOnly: false, fast: null });
        expect(parseRule('**/foo')).toMatchObject({
            nameOnly: true,
            fast: { kind: 'literal', value: 'foo' },
        });
        expect(parseRule('')).toBeNull();
        expect(parseRule('**/')).toMatchObject({ dirOnly: true, fast: null });
    });
});
