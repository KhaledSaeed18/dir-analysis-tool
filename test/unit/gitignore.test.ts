import { describe, expect, it } from 'vitest';
import { GitignoreMatcher, LinearGlob, parseRule } from '../../src/core/gitignore.ts';

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

describe('rules with several wildcards', () => {
    /** Generous for slow CI machines; a backtracking regex needs far longer than this. */
    const LIMIT_MS = 2000;

    function elapsed(run: () => void): number {
        const started = performance.now();
        run();
        return performance.now() - started;
    }

    it.each([
        ['a*'.repeat(6) + 'b', 'a'.repeat(200)],
        ['a*'.repeat(40) + 'b', 'a'.repeat(4000)],
        ['*a'.repeat(30) + '*b', 'a'.repeat(4000)],
        ['**/a*/**/a*/**/a*/b', `${'a/'.repeat(1000)}c`],
        ['x/**/**/**/**/y', `x/${'a/'.repeat(1000)}z`],
        ['a?*?*?*?*?*?*b', 'a'.repeat(1000)],
        ['[a]*[a]*[a]*[a]*[a]*[a]*b', 'a'.repeat(1000)],
    ])('stay fast on %s', (pattern, path) => {
        const exact = GitignoreMatcher.compile(pattern);
        const sensitive = elapsed(() => exact.test(path, false));
        const folded = GitignoreMatcher.compile(pattern, { ignoreCase: true });
        expect(sensitive + elapsed(() => folded.test(path, false))).toBeLessThan(LIMIT_MS);
    });

    it('stay fast with many such rules', () => {
        const rules = Array.from({ length: 500 }, (_, i) => `a*a*a*a*a*a*${i}`);
        const compiled = GitignoreMatcher.compile(rules);
        const path = 'a'.repeat(300);
        expect(elapsed(() => compiled.test(path, false))).toBeLessThan(LIMIT_MS);
    });

    it('match by name or by path, and respect directory-only rules', () => {
        const m = matcher(['*.*', 'a*b*/', 'src/**/*.map', '**/gen/*.js']);
        expect(m.test('x/y/file.txt', false)).toBe(true);
        expect(m.test('noext', false)).toBeUndefined();
        expect(m.test('x/axbx', true)).toBe(true);
        expect(m.test('x/axbx', false)).toBeUndefined();
        expect(m.test('src/a/b/c.map', false)).toBe(true);
        expect(m.test('lib/src/c.map', false)).toBe(true); // via *.*
        expect(m.test('x/y/gen/a.js', false)).toBe(true);
    });

    it('keep later rules winning across both kinds of matching', () => {
        const m = matcher(['a*b*c', '!axbxc', '*.log', '!x*y*.log', 'xkeyz.log']);
        expect(m.test('aqbqc', false)).toBe(true);
        expect(m.test('axbxc', false)).toBe(false);
        expect(m.test('other.log', false)).toBe(true);
        expect(m.test('x1y2.log', false)).toBe(false);
        expect(m.test('xkeyz.log', false)).toBe(true);
    });

    it('use the required text only to skip work, never to change a result', () => {
        const fold = matcher(['*.PART*', '**/CACHE/*.tmp'], true);
        expect(fold.test('a.part1', false)).toBe(true);
        expect(fold.test('A.Part1', false)).toBe(true);
        expect(fold.test('a/cache/b.TMP', false)).toBe(true);
        expect(fold.test('a.pert1', false)).toBeUndefined();
        const exact = matcher(['*.part*']);
        expect(exact.test('a.part1', false)).toBe(true);
        expect(exact.test('a.PART1', false)).toBeUndefined();
    });

    it('fold case the way a regular expression does', () => {
        const m = matcher(['A*B*C', '[x-z]*[Q]*'], true);
        expect(m.test('a1b2c', false)).toBe(true);
        expect(m.test('Y1q2', false)).toBe(true);
        expect(matcher(['A*B*C']).test('a1b2c', false)).toBeUndefined();
    });

    it('agree with the regular expression generated from the same rule', () => {
        let seed = 0x2b7e15;
        const random = (n: number): number => {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return (seed >>> 0) % n;
        };
        const atoms = [
            'a',
            'b',
            'A',
            '.',
            '/',
            '*',
            '*',
            '**',
            '**/',
            '/**',
            '?',
            '[ab]',
            '[!a]',
            '[z-a]',
            '\\*',
            'é',
            '\n',
            'k',
            's',
            String.fromCharCode(0xb5),
        ];
        const letters = [
            'a',
            'b',
            'A',
            'B',
            '.',
            '/',
            '/',
            'é',
            'É',
            '\n',
            '*',
            'k',
            'K',
            String.fromCharCode(0x212a),
            's',
            'S',
            String.fromCharCode(0x17f),
            String.fromCharCode(0xb5),
            String.fromCharCode(0x3bc),
        ];
        let compared = 0;
        for (let i = 0; i < 4000; i++) {
            const pattern = Array.from(
                { length: 1 + random(7) },
                () => atoms[random(atoms.length)]
            ).join('');
            const rule = parseRule(pattern);
            if (rule === null || rule.negated) continue;
            for (const ignoreCase of [false, true]) {
                const glob = new LinearGlob(rule, ignoreCase);
                const whole = GitignoreMatcher.compile([pattern], { ignoreCase });
                const regex = new RegExp(`^(?:${rule.source})$`, ignoreCase ? 'i' : '');
                for (let j = 0; j < 20; j++) {
                    const text = Array.from(
                        { length: random(9) },
                        () => letters[random(letters.length)]
                    ).join('');
                    expect(`${pattern} ${text} ${glob.matches(text)}`).toBe(
                        `${pattern} ${text} ${regex.test(text)}`
                    );
                    // Rules with fewer wildcards never reach the pre-check; compare them with themselves.
                    const subject = rule.nameOnly ? text.slice(text.lastIndexOf('/') + 1) : text;
                    const actual = whole.test(text, true) === true;
                    const expected = rule.wildcards >= 2 ? regex.test(subject) : actual;
                    expect(`${pattern} ${text} ${actual}`).toBe(`${pattern} ${text} ${expected}`);
                    compared++;
                }
            }
        }
        expect(compared).toBeGreaterThan(50000);
    });
});

describe('line breaks in names', () => {
    it('are matched by every kind of wildcard', () => {
        const m = matcher(['build/**', 'x/**/y', 'deep/**/*.log', '**/d/**', 'n*e']);
        expect(m.test('build/a\nb', false)).toBe(true);
        expect(m.test('build/a\rb', false)).toBe(true);
        expect(m.test('x/a\nb/y', false)).toBe(true);
        expect(m.test('deep/a\nb/c\nd.log', false)).toBe(true);
        expect(m.test('q\nr/d/s\nt', false)).toBe(true);
        expect(m.test('n\ne', false)).toBe(true);
    });
});

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
        const m = matcher(['name   ', 'trail\\ ', 'slash\\\\ ']);
        expect(m.test('name', false)).toBe(true);
        expect(m.test('trail ', false)).toBe(true);
        expect(m.test('trail', false)).toBeUndefined();
        expect(m.test('slash\\', false)).toBe(true); // the backslash is escaped, not the space
    });

    it('keeps trailing tabs, which are part of the pattern', () => {
        const m = matcher(['tabbed\t']);
        expect(m.test('tabbed\t', false)).toBe(true);
        expect(m.test('tabbed', false)).toBeUndefined();
    });

    it('skips a byte order mark at the start of a file', () => {
        const m = matcher('\uFEFFfirst.txt\nsecond.txt\n');
        expect(m.test('first.txt', false)).toBe(true);
        expect(m.test('second.txt', false)).toBe(true);
    });

    it('strips a carriage return from the last line of a file', () => {
        expect(matcher('last.txt\r').test('last.txt', false)).toBe(true);
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
        const m = matcher(['build/']);
        expect(m.test('build', false)).toBeUndefined();
        expect(m.test('build', true)).toBe(true);
        expect(ignored(m, 'build/out.js')).toBe(true);
        expect(matcher(['/']).hasRules).toBe(false);
        expect(matcher(['!']).hasRules).toBe(false);
    });

    it('removes only one slash from either end of a pattern', () => {
        expect(matcher(['tmp//']).test('tmp', true)).toBeUndefined();
        expect(matcher(['//tmp']).test('tmp', false)).toBeUndefined();
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

    it('treats malformed patterns as never matching', () => {
        for (const pattern of [
            '[abc',
            '[',
            '[]',
            '[!]',
            '[a\\]',
            '[[:nope:]]',
            '[[:alpha:]',
            'a\\',
        ]) {
            const m = matcher(pattern);
            expect(m.hasRules).toBe(false);
            expect(m.test(pattern, false)).toBeUndefined();
        }
    });

    it('survives reversed ranges, which match only their first character', () => {
        // A reversed range used to reach the regular expression and throw.
        const m = matcher(['file[z-a].txt', 'other[!z-a]']);
        expect(m.test('filez.txt', false)).toBe(true);
        expect(m.test('filea.txt', false)).toBeUndefined();
        expect(m.test('filem.txt', false)).toBeUndefined();
        expect(m.test('otherm', false)).toBe(true);
        expect(m.test('otherz', false)).toBeUndefined();
    });

    it('never lets a class match a slash, even one it lists', () => {
        const m = matcher(['[a/b]c', 'x[/]y', 'n[+-9]m']);
        expect(m.test('ac', false)).toBe(true);
        expect(m.test('bc', false)).toBe(true);
        expect(m.test('/c', false)).toBeUndefined();
        expect(m.test('x/y', false)).toBeUndefined();
        expect(m.test('n5m', false)).toBe(true);
        expect(m.test('n/m', false)).toBeUndefined(); // "/" falls inside the range
    });

    it('treats a bracket without a closing ":]" as an ordinary class member', () => {
        const m = matcher('[[:x]');
        expect(m.test('[', false)).toBe(true);
        expect(m.test('x', false)).toBe(true);
        expect(m.test('y', false)).toBeUndefined();
    });

    it('honors escapes inside classes and range endpoints', () => {
        const m = matcher(['[\\]]', 'r[a-\\c]', 'm[\\a-c]', 'e[\\-]']);
        expect(m.test(']', false)).toBe(true);
        expect(m.test('rb', false)).toBe(true);
        expect(m.test('mb', false)).toBe(true);
        expect(m.test('e-', false)).toBe(true);
    });

    it('honors backslash escapes', () => {
        const m = matcher(['esc\\ aped', 'star\\*', 'q\\?', 'back\\\\slash']);
        expect(m.test('esc aped', false)).toBe(true);
        expect(m.test('star*', false)).toBe(true);
        expect(m.test('starx', false)).toBeUndefined();
        expect(m.test('q?', false)).toBe(true);
        expect(m.test('back\\slash', false)).toBe(true);
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
