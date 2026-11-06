import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze.ts';
import { GitignoreMatcher } from '../../src/core/gitignore.ts';
import { fixture, isWindows } from '../helpers/fixture.ts';

const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: isWindows ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd: string, args: string[], input?: string) {
    return spawnSync('git', args, { cwd, env, encoding: 'utf8', input });
}

const hasGit = git('.', ['--version']).status === 0;

/** Whether Git ignores each path, asking it about all of them at once. */
function gitVerdicts(cwd: string, paths: readonly string[]): boolean[] {
    const args = ['check-ignore', '-v', '-n', '--no-index', '-z', '--stdin'];
    const result = git(cwd, args, paths.map((path) => `${path}\0`).join(''));
    if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr);
    const fields = result.stdout.split('\0');
    return paths.map((_, i) => {
        const rule = fields[i * 4 + 2];
        return rule !== undefined && rule !== '' && !rule.startsWith('!');
    });
}

/** The scanner's view: an ignored directory is never entered. */
function datVerdict(matcher: GitignoreMatcher, path: string): boolean {
    const segments = path.split('/');
    for (let i = 1; i <= segments.length; i++) {
        const isDirectory = i < segments.length;
        if (matcher.test(segments.slice(0, i).join('/'), isDirectory) === true) return true;
    }
    return false;
}

// prettier-ignore
const PATTERNS = [
    'a', 'a/', '/a', 'a/b', '*', '*/', '/*', '**', '**/', '/**/', 'a/**', 'a/**/', '**/a', 'a/*', 'a/*/b',
    'a/**/b', 'a**b', 'a*b', '**a', 'a**', '**/**/a', '***', '*.txt', '?', '??', 'a?', '[ab]', '[!a]', '[^a]',
    '[a-c]', '[]]', '[]a]', '[!]]', '[a', '[', ']', '[]', '[!]', '[a/b]', '[a/b]c', 'a[/]b', '[z-a]', '[!z-a]',
    '[[:alpha:]]', '[[:digit:]]', '[[:foo:]]', '[[:alpha:]', '[[:x]', '[\\]]', '[a\\]', '[a-]', '[-a]', '[\\-a]',
    '\\a', 'a\\', 'a\\\\', '\\*', '\\?', '\\ ', 'a\\ ', 'a ', 'a  ', 'a\\  ', 'a\\\\ ', ' a', 'a\t', 'a \t',
    '\\#a', '#a', '\\!a', '!a', '!', '/', '//a', 'a//b', 'a//', './a', '.a', '.*', 'a.b', 'a+b', '(a)', 'a|b',
    'a$', '^a', '{a,b}', '*.*', 'a*b*', '*a*b', '*a*a*', 'a*/*b', '*/*', '*/*/*', 'a/**/*', '**/a/*', '**/*/a',
    '**/a/**', 'a/**/b/**', 'a/**/c/**/b', 'x/**/a/**', '*a*/**/b', '?*?', '*?*', '[ab]*[bc]', '*[ab]*', 'a*\\*b',
    'x/**', 'a/**/', '**/*/', '*a*/', 'a/*/**',
];

// prettier-ignore
const PATHS = [
    'a', 'b', 'ab', 'axb', 'a b', 'a ', ' a', 'a\t', '.a', 'a.b', 'a+b', '(a)', 'a|b', 'a$', '^a', '{a,b}', '[a]', '[',
    ']', '[]', 'z', '1', '-', 'c', 'ac', 'bc', 'x.txt', 'a\\', '#a', '!a', 'a/b', 'a/c', 'a/c/b', 'a/c/d/b', 'x/a',
    'x/a/b', 'x/y/a', 'a/b/c', 'aab', 'abab', 'bab', 'a*b', 'a/x/b/y', 'a/x/c/y/b', 'x/q/a/r', 'a\nb', 'x/a\nb', 'a/b\nc',
    'a\rb', 'a/c\nd/b',
];

describe.skipIf(!hasGit || isWindows)('parity with git check-ignore', () => {
    it('agrees with Git on each rule', async () => {
        const root = await fixture({ keep: '' });
        git(root, ['init', '-q']);
        git(root, ['config', 'core.ignorecase', 'false']);
        const differences: string[] = [];
        for (const pattern of PATTERNS) {
            await writeFile(join(root, '.gitignore'), `${pattern}\n`);
            const verdicts = gitVerdicts(root, PATHS);
            const matcher = GitignoreMatcher.compile(`${pattern}\n`);
            PATHS.forEach((path, i) => {
                if (datVerdict(matcher, path) !== verdicts[i]) {
                    differences.push(`${JSON.stringify(pattern)} on ${JSON.stringify(path)}`);
                }
            });
        }
        expect(differences).toEqual([]);
    });

    it('agrees with Git when rules with a byte order mark and CRLF share a file', async () => {
        const root = await fixture({ keep: '' });
        git(root, ['init', '-q']);
        git(root, ['config', 'core.ignorecase', 'false']);
        const content = '\uFEFFa\r\n*.txt\r\n!x.txt\r\n[z-a]\r\nb';
        await writeFile(join(root, '.gitignore'), content);
        const matcher = GitignoreMatcher.compile(content);
        const verdicts = gitVerdicts(root, PATHS);
        expect(PATHS.map((path) => datVerdict(matcher, path))).toEqual(verdicts);
    });
});

describe('scanning with awkward ignore rules', () => {
    it('does not hang on many wildcards and a long name', { timeout: 5000 }, async () => {
        const name = 'a'.repeat(200);
        const root = await fixture({ '.gitignore': `${'a*'.repeat(8)}b\n`, [name]: 'x' });
        const result = await analyze(root, { gitignore: true });
        expect(result.summary.files).toBe(2);
        const excluded = await analyze(root, { exclude: [`${'a*'.repeat(8)}a`] });
        expect(excluded.summary.excluded).toBe(1);
    });

    it('does not fail on a reversed character range', async () => {
        const root = await fixture({
            '.gitignore': '*.log\nfile[z-a].txt\n',
            'a.log': 'x',
            'filez.txt': 'x',
            'kept.txt': 'x',
        });
        const result = await analyze(root, { gitignore: true });
        expect(result.summary.files).toBe(2); // .gitignore and kept.txt
    });

    it('does not fail on a reversed character range given as a pattern', async () => {
        const root = await fixture({ 'z.txt': 'x', 'y.txt': 'x' });
        const result = await analyze(root, { exclude: ['[z-a].txt'] });
        expect(result.summary.files).toBe(1);
    });

    it('honors the first rule of a file that starts with a byte order mark', async () => {
        const root = await fixture({
            '.gitignore': '\uFEFFsecret.txt\n',
            'secret.txt': 'x',
            'kept.txt': 'x',
        });
        const result = await analyze(root, { gitignore: true });
        expect(result.summary.excluded).toBe(1);
    });

    it.skipIf(!hasGit)('honors info/exclude in a real linked worktree', async () => {
        const root = await fixture({ 'main/keep': '' });
        const main = join(root, 'main');
        const worktree = join(root, 'wt');
        git(main, ['init', '-q']);
        git(main, ['add', 'keep']);
        git(main, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init']);
        git(main, ['worktree', 'add', '-q', worktree]);
        await writeFile(join(main, '.git', 'info', 'exclude'), 'secret.txt\n');
        await writeFile(join(worktree, 'secret.txt'), 'x');
        const result = await analyze(worktree, { gitignore: true });
        expect(result.summary.excluded).toBe(1);
    });
});
