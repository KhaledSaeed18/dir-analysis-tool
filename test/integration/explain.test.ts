import { spawnSync } from 'node:child_process';
import { chmod, link, mkdir, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze.ts';
import { explainPath, explainSkips, type PathExplanation } from '../../src/core/explain.ts';
import { resolveScan, type ScanSettings } from '../../src/core/options.ts';
import { Scanner } from '../../src/core/scanner.ts';
import { renderPathExplanation, renderSkipsExplanation } from '../../src/reporters/explain.ts';
import { cli, json } from '../helpers/cli.ts';
import { fixture, isRoot, isWindows, type Tree } from '../helpers/fixture.ts';

/** Every file and directory a real scan counts, as root-relative paths. */
async function scanned(root: string, settings: ScanSettings): Promise<Set<string>> {
    const { options } = await resolveScan(root, settings, Date.now());
    const seen = new Set<string>();
    const scanner: Scanner = new Scanner(options, {
        directory: (index) => seen.add(scanner.relativePath(index)),
        file: (dir, name) => seen.add(scanner.relativePath(dir, name)),
    });
    await scanner.run();
    return seen;
}

/** Explains a path and asserts the decision equals what the scanner actually does. */
async function explain(
    root: string,
    path: string,
    settings: ScanSettings = {}
): Promise<PathExplanation> {
    const result = await explainPath(root, path, settings);
    const counted = (await scanned(root, settings)).has(result.path);
    // A missing path is never counted, so "not-found" must agree as well.
    expect(counted, `scanner and explain disagree on ${path}`).toBe(result.decision === 'included');
    return result;
}

async function tree(entries: Tree): Promise<string> {
    return fixture(entries);
}

/** Summary totals must equal the analysis summary with the same settings. */
async function skips(root: string, settings: ScanSettings & { limit?: number } = {}) {
    const result = await explainSkips(root, settings);
    const analysis = await analyze(root, settings);
    expect(result.totals.excluded).toBe(analysis.summary.excluded);
    expect(result.totals.filtered).toBe(analysis.summary.filtered);
    expect(result.totals.symlinks).toBe(analysis.summary.symlinks);
    expect(result.totals.hardlinks).toBe(analysis.summary.hardlinks);
    expect(result.totals.errors).toBe(analysis.summary.errors);
    const listed = result.groups
        .filter((g) => g.source !== 'max-depth' && g.source !== 'symlink')
        .reduce((sum, g) => sum + g.count, 0);
    expect(listed).toBe(result.totals.excluded + result.totals.filtered);
    return result;
}

const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: isWindows ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
};
const hasGit = spawnSync('git', ['--version']).status === 0;

/** `git check-ignore -v` for many paths: the matching rule of each, or null. */
function gitRules(
    cwd: string,
    paths: readonly string[]
): Array<{ file: string; line: number; pattern: string } | null> {
    const result = spawnSync('git', ['check-ignore', '-v', '-n', '--no-index', '-z', '--stdin'], {
        cwd,
        env: gitEnv,
        encoding: 'utf8',
        input: paths.map((p) => `${p}\0`).join(''),
    });
    const fields = result.stdout.split('\0');
    return paths.map((_, i) => {
        const file = fields[i * 4];
        return file ? { file, line: Number(fields[i * 4 + 1]), pattern: fields[i * 4 + 2]! } : null;
    });
}

/** `git check-ignore -v` for one path: the deciding file and line, or null. */
function gitRule(cwd: string, path: string): { file: string; line: number } | null {
    const result = spawnSync('git', ['check-ignore', '-v', '-n', '--no-index', path], {
        cwd,
        env: gitEnv,
        encoding: 'utf8',
    });
    const match = /^(.*?):(\d+):/.exec(result.stdout);
    return match && match[1] ? { file: match[1], line: Number(match[2]) } : null;
}

describe('explainPath: default excludes (fixtures 1-4, 21)', () => {
    it('1: a path inside node_modules is excluded at node_modules', async () => {
        const root = await tree({ 'node_modules/x/a': 'a', 'b.txt': 'b' });
        const result = await explain(root, 'node_modules/x/a');
        expect(result).toMatchObject({
            decision: 'excluded',
            type: 'file',
            descendants: null,
            reason: { source: 'default', at: 'node_modules', ancestor: true, rule: 'node_modules' },
        });
    });

    it('2: a negation pattern cannot re-include a default exclude', async () => {
        const root = await tree({ 'node_modules/x/a': 'a' });
        const result = await explain(root, 'node_modules/x/a', { exclude: ['!node_modules'] });
        expect(result.decision).toBe('excluded');
        expect(result.notes.map((n) => n.code)).toContain('negation-cannot-reach-default');
        expect(result.notes.find((n) => n.code === 'negation-cannot-reach-default')).toMatchObject({
            rule: '!node_modules',
            index: 0,
        });
    });

    it('3: --all includes it', async () => {
        const root = await tree({ 'node_modules/x/a': 'a' });
        const result = await explain(root, 'node_modules/x/a', { defaultExcludes: false });
        expect(result).toMatchObject({ decision: 'included', reason: null, type: 'file' });
    });

    it('4: a regular file named node_modules is included', async () => {
        const root = await tree({ node_modules: 'not a directory' });
        expect((await explain(root, 'node_modules')).decision).toBe('included');
    });

    it('21: default names compare exactly', async () => {
        const root = await tree({ 'NODE_MODULES/a': 'a' });
        expect((await explain(root, 'NODE_MODULES/a')).decision).toBe('included');
    });
});

describe('explainPath: patterns and .gitignore (fixtures 5-14, 33, 34)', () => {
    it('5: a later negation re-includes a file, in -e and .gitignore form', async () => {
        const root = await tree({
            'keep.log': 'k',
            'drop.log': 'd',
            '.gitignore': '*.log\n!keep.log\n',
        });
        const byPattern = await explain(root, 'keep.log', { exclude: ['*.log', '!keep.log'] });
        expect(byPattern.decision).toBe('included');
        const dropped = await explain(root, 'drop.log', { exclude: ['*.log', '!keep.log'] });
        expect(dropped.reason).toMatchObject({ source: 'pattern', rule: '*.log', index: 0 });

        expect((await explain(root, 'keep.log', { gitignore: true })).decision).toBe('included');
        const ignored = await explain(root, 'drop.log', { gitignore: true });
        expect(ignored.reason).toMatchObject({ source: 'gitignore', file: '.gitignore', line: 1 });
    });

    it('6: a negation cannot re-include a path whose parent is excluded', async () => {
        const root = await tree({
            'build/keep/k.txt': 'k',
            '.gitignore': 'build/\n!build/keep/\n',
        });
        const result = await explain(root, 'build/keep/k.txt', { gitignore: true });
        expect(result).toMatchObject({
            decision: 'excluded',
            reason: {
                source: 'gitignore',
                at: 'build',
                ancestor: true,
                file: '.gitignore',
                line: 1,
            },
        });
        expect(result.notes.find((n) => n.code === 'negation-blocked-by-parent')).toMatchObject({
            file: '.gitignore',
            line: 2,
            rule: '!build/keep/',
        });
        const text = renderPathExplanation(result);
        expect(text).toContain('Decided at  build (parent directory)');
        expect(text).toContain('.gitignore:1  build/');
        expect(text).toContain('not measured');
    });

    it.skipIf(!hasGit || isWindows)(
        '7: each deciding line matches git check-ignore -v',
        async () => {
            const root = await tree({
                '.gitignore': 'vendor/*\n!vendor/keep/\nvendor/keep/*.bin\n!ok.bin\n',
                'vendor/a.txt': 'a',
                'vendor/keep/x.bin': 'x',
                'vendor/keep/ok.bin': 'o',
                'vendor/keep/y.txt': 'y',
            });
            spawnSync('git', ['init', '-q'], { cwd: root, env: gitEnv });
            for (const path of ['vendor/a.txt', 'vendor/keep/x.bin', 'vendor/keep/ok.bin']) {
                const result = await explain(root, path, { gitignore: true });
                const expected = gitRule(root, path);
                expect(expected).not.toBeNull();
                expect({
                    file: result.reason?.file ?? null,
                    line: result.reason?.line ?? null,
                }).toEqual(
                    result.decision === 'included'
                        ? { file: null, line: null }
                        : { file: expected!.file, line: expected!.line }
                );
            }
            // ok.bin is decided by the negation on line 4, so it is included.
            expect((await explain(root, 'vendor/keep/ok.bin', { gitignore: true })).decision).toBe(
                'included'
            );
            expect(gitRule(root, 'vendor/keep/ok.bin')?.line).toBe(4);
            expect((await explain(root, 'vendor/keep/y.txt', { gitignore: true })).decision).toBe(
                'included'
            );
        }
    );

    it('8: an -e negation cannot reach a .gitignore rule', async () => {
        const root = await tree({ 'x.log': 'x', '.gitignore': '*.log\n' });
        const result = await explain(root, 'x.log', { gitignore: true, exclude: ['!x.log'] });
        expect(result.reason).toMatchObject({ source: 'gitignore', line: 1 });
        expect(result.notes.map((n) => n.code)).toContain('negation-cannot-reach-gitignore');
    });

    it('9: -e patterns are checked before .gitignore', async () => {
        const root = await tree({ 'a.log': 'a', '.gitignore': '!a.log\n' });
        const result = await explain(root, 'a.log', { gitignore: true, exclude: ['a.log'] });
        expect(result.reason).toMatchObject({ source: 'pattern', rule: 'a.log' });
    });

    it('10: command-line patterns come after config patterns', async () => {
        const root = await tree({ 'a.log': 'a', '.dir-analyzer.json': '{"exclude":["*.log"]}' });
        const included = await cli(['explain', 'a.log', '-e', '!a.log', '--json'], { cwd: root });
        expect(json(included)['decision']).toBe('included');
        const excluded = await cli(['explain', 'a.log', '--json'], { cwd: root });
        expect(json(excluded)['reason']).toMatchObject({ source: 'pattern', index: 0 });
    });

    it('11: the deepest deciding file is reported, both ways', async () => {
        const root = await tree({
            '.gitignore': '*.tmp\n',
            'sub/.gitignore': '!keep.tmp\nlocal.txt\n',
            'sub/keep.tmp': 'k',
            'sub/drop.tmp': 'd',
            'sub/local.txt': 'l',
            'local.txt': 'l',
        });
        const settings = { gitignore: true };
        expect((await explain(root, 'sub/keep.tmp', settings)).decision).toBe('included');
        expect((await explain(root, 'sub/drop.tmp', settings)).reason).toMatchObject({
            file: '.gitignore',
            line: 1,
        });
        expect((await explain(root, 'sub/local.txt', settings)).reason).toMatchObject({
            file: 'sub/.gitignore',
            line: 2,
        });
        expect((await explain(root, 'local.txt', settings)).decision).toBe('included');
    });

    it('12: a .gitignore inside an ignored directory is never read', async () => {
        const root = await tree({
            '.gitignore': 'logs/\n',
            'logs/.gitignore': '!*\n',
            'logs/a': 'a',
        });
        const result = await explain(root, 'logs/a', { gitignore: true });
        expect(result.reason).toMatchObject({ at: 'logs', ancestor: true, line: 1 });
    });

    it('13: an anchored rule in a nested file applies at its level only', async () => {
        const root = await tree({
            'sub/.gitignore': '/only-here.txt\n',
            'sub/only-here.txt': 'a',
            'sub/deeper/only-here.txt': 'b',
            'only-here.txt': 'c',
        });
        const settings = { gitignore: true };
        expect((await explain(root, 'sub/only-here.txt', settings)).decision).toBe('excluded');
        expect((await explain(root, 'sub/deeper/only-here.txt', settings)).decision).toBe(
            'included'
        );
        expect((await explain(root, 'only-here.txt', settings)).decision).toBe('included');
    });

    it('14: a .gitignore negation overrides info/exclude', async () => {
        const root = await tree({
            '.git/info/exclude': '*.secret\n',
            '.gitignore': '!a.secret\n',
            'a.secret': 'a',
            'b.secret': 'b',
        });
        const settings = { gitignore: true };
        expect((await explain(root, 'a.secret', settings)).decision).toBe('included');
        expect((await explain(root, 'b.secret', settings)).reason).toMatchObject({
            source: 'info-exclude',
            file: '.git/info/exclude',
            line: 1,
        });
    });

    it('33: malformed rules never decide, except a reversed range as in Git', async () => {
        const root = await tree({
            '.gitignore': '[a\na\\\n[z-a]\n',
            '[a': '1',
            'a\\': isWindows ? '' : '2',
            z: '3',
        });
        expect((await explain(root, '[a', { gitignore: true })).decision).toBe('included');
        expect((await explain(root, 'z', { gitignore: true })).reason).toMatchObject({
            line: 3,
            rule: '[z-a]',
        });
    });

    it('34: a byte order mark does not shift line numbers', async () => {
        const root = await tree({ '.gitignore': '﻿*.log\n', 'a.log': 'a' });
        expect((await explain(root, 'a.log', { gitignore: true })).reason).toMatchObject({
            line: 1,
            rule: '*.log',
        });
    });
});

describe('explainPath: repositories (fixtures 15-19)', () => {
    it('15: a linked worktree reads info/exclude from the main repository', async () => {
        const root = await tree({
            'main/.git/info/exclude': 'secret.txt\n',
            'main/.git/worktrees/wt/commondir': '../..\n',
            'wt/.git': 'gitdir: ../main/.git/worktrees/wt\n',
            'wt/secret.txt': 's',
        });
        const result = await explain(join(root, 'wt'), 'secret.txt', { gitignore: true });
        expect(result.reason).toMatchObject({
            source: 'info-exclude',
            file: '../main/.git/info/exclude',
            line: 1,
        });
    });

    it('16: a root below the repository root reports the ancestor file and line', async () => {
        const root = await tree({
            '.git/HEAD': 'ref',
            '.gitignore': '# comment\n/sub/drop.txt\n',
            'sub/drop.txt': 'd',
        });
        const result = await explain(join(root, 'sub'), 'drop.txt', { gitignore: true });
        expect(result.reason).toMatchObject({
            source: 'gitignore',
            file: '../.gitignore',
            line: 2,
        });
        expect(result.notes.map((n) => n.code)).toContain('global-excludes-not-read');
    });

    it('17: a root inside an ignored directory is scanned, with a note', async () => {
        const root = await tree({
            '.git/HEAD': 'ref',
            '.gitignore': 'build/\n',
            'build/sub/a': 'a',
        });
        const result = await explain(join(root, 'build', 'sub'), 'a', { gitignore: true });
        expect(result.decision).toBe('included');
        expect(result.notes.find((n) => n.code === 'root-ignored-by-git')).toMatchObject({
            path: 'build',
            file: '../../.gitignore',
            line: 1,
        });
        const summary = await skips(join(root, 'build', 'sub'), { gitignore: true });
        expect(summary.notes.map((n) => n.code)).toContain('root-ignored-by-git');
    });

    it('18: nested repositories are disclosed', async () => {
        const root = await tree({
            '.gitignore': '*.log\n',
            'inner/.git/HEAD': 'ref',
            'inner/.git/info/exclude': 'x.txt\n',
            'inner/a.log': 'a',
            'inner/x.txt': 'x',
        });
        const result = await explain(root, 'inner/a.log', { gitignore: true });
        expect(result.reason).toMatchObject({ file: '.gitignore', line: 1 });
        expect(result.notes.map((n) => n.code)).toContain('nested-repository');
        expect((await explain(root, 'inner/x.txt', { gitignore: true })).decision).toBe('included');
    });

    it('19: a .gitignore is honored without a repository', async () => {
        const root = await tree({ '.gitignore': 'a\n', a: 'a' });
        const result = await explain(root, 'a', { gitignore: true });
        expect(result.decision).toBe('excluded');
        expect(result.notes.map((n) => n.code)).not.toContain('global-excludes-not-read');
    });
});

describe('explainPath: case, links, filters, depth (fixtures 20, 22-28)', () => {
    it('20: case-insensitive matches follow the platform setting and are noted', async () => {
        const root = await tree({ 'build/a': 'a', '.gitignore': 'BUILD/\n' });
        const result = await explain(root, 'build/a', { gitignore: true });
        const codes = result.notes.map((n) => n.code);
        expect(result.decision).toBe(result.ignoreCase ? 'excluded' : 'included');
        expect(codes.includes('case-rule-from-platform')).toBe(result.ignoreCase);
    });

    it.skipIf(isWindows)(
        '22: symlinks are skipped, or re-checked as directories with -L',
        async () => {
            const root = await tree({
                'real/a': 'a',
                link: { symlink: 'real' },
                '.gitignore': 'link/\n',
            });
            const plain = await explain(root, 'link', { gitignore: true });
            expect(plain).toMatchObject({
                decision: 'skipped',
                type: 'symlink',
                reason: { source: 'symlink' },
            });
            const followed = await explain(root, 'link', { gitignore: true, followSymlinks: true });
            expect(followed).toMatchObject({
                decision: 'excluded',
                reason: { source: 'gitignore', line: 1 },
            });
            const through = await explainPath(root, 'real/a', { followSymlinks: true });
            expect(through.decision).toBe('included');
            const viaLink = await explainPath(root, 'link/a', { followSymlinks: true });
            expect(viaLink.notes.map((n) => n.code)).toContain('symlink-order-dependent');
        }
    );

    it('23: size bounds are inclusive and reported', async () => {
        const root = await tree({
            s1023: { size: 1023 },
            s1024: { size: 1024 },
            s1025: { size: 1025 },
        });
        const settings = { minSize: 1024, maxSize: 1024 };
        expect((await explain(root, 's1024', settings)).decision).toBe('included');
        expect((await explain(root, 's1023', settings)).reason).toMatchObject({
            source: 'size',
            rule: 'minSize',
            limit: 1024,
            actual: 1023,
        });
        expect((await explain(root, 's1025', settings)).reason).toMatchObject({
            rule: 'maxSize',
            actual: 1025,
        });
        const text = renderPathExplanation(await explainPath(root, 's1023', settings));
        expect(text).toContain('--min-size 1 KiB; the file is 1023 B');
    });

    it('24: date bounds are inclusive, in local time, with end of day for --older-than', async () => {
        const root = await tree({
            before: { size: 1, mtime: new Date(2024, 0, 14, 23, 59, 59) },
            start: { size: 1, mtime: new Date(2024, 0, 15, 0, 0, 0) },
            end: { size: 1, mtime: new Date(2024, 0, 15, 23, 59, 59) },
            after: { size: 1, mtime: new Date(2024, 0, 16, 0, 0, 0) },
        });
        const settings = { modifiedAfter: '2024-01-15', modifiedBefore: '2024-01-15' };
        expect((await explain(root, 'start', settings)).decision).toBe('included');
        expect((await explain(root, 'end', settings)).decision).toBe('included');
        expect((await explain(root, 'before', settings)).reason).toMatchObject({
            source: 'date',
            rule: 'modifiedAfter',
        });
        const late = await explain(root, 'after', settings);
        expect(late.reason).toMatchObject({ source: 'date', rule: 'modifiedBefore' });
        expect(late.reason?.limit).toBe(new Date(2024, 0, 15, 23, 59, 59, 999).toISOString());
    });

    it('25: exclusion comes before filters', async () => {
        const root = await tree({ 'a.log': { size: 1 } });
        const result = await explain(root, 'a.log', { exclude: ['*.log'], minSize: 100 });
        expect(result).toMatchObject({ decision: 'excluded', reason: { source: 'pattern' } });
    });

    it.skipIf(isWindows)('26: hard links are disclosed as order dependent', async () => {
        const root = await tree({ 'a/one': { size: 10 } });
        await mkdir(join(root, 'b'));
        await link(join(root, 'a', 'one'), join(root, 'b', 'two'));
        const result = await explainPath(root, 'b/two', { maxSize: 5 });
        expect(result.decision).toBe('filtered');
        expect(result.notes.map((n) => n.code)).toContain('hardlink-order-dependent');
        const summary = await skips(root, { maxSize: 5 });
        expect(summary.totals).toMatchObject({ filtered: 1, hardlinks: 1 });
        expect(summary.notes.map((n) => n.code)).toContain('hardlink-order-dependent');
    });

    it('27: paths beyond --max-depth are skipped and counted', async () => {
        const root = await tree({ 'a/b/c.txt': 'c', 'a/x.txt': 'x', 'top.txt': 't' });
        const deep = await explain(root, 'a/b/c.txt', { maxDepth: 1 });
        expect(deep).toMatchObject({
            decision: 'skipped',
            reason: { source: 'max-depth', at: 'a/b', ancestor: true, limit: 1, actual: 2 },
        });
        expect((await explain(root, 'a/x.txt', { maxDepth: 1 })).decision).toBe('included');
        const summary = await skips(root, { maxDepth: 1 });
        expect(summary.totals.depthSkipped).toBe(1);
        expect(summary.groups[0]).toMatchObject({ source: 'max-depth', entries: ['a/b'] });
    });

    it.skipIf(isWindows || isRoot)(
        '28: an unreadable directory is skipped with its error',
        async () => {
            const root = await tree({ 'locked/a': 'a' });
            await chmod(join(root, 'locked'), 0o000);
            try {
                const result = await explainPath(root, 'locked/a');
                expect(result).toMatchObject({
                    decision: 'skipped',
                    reason: { source: 'error', at: 'locked', code: 'EACCES' },
                });
                const summary = await skips(root);
                expect(summary.totals.errors).toBe(1);
                expect(summary.errors[0]).toMatchObject({ path: 'locked', code: 'EACCES' });
            } finally {
                await chmod(join(root, 'locked'), 0o755);
            }
        }
    );
});

describe('explainPath: awkward paths (fixtures 29, 30, 32)', () => {
    it('29: missing paths, with and without an excluded ancestor', async () => {
        const root = await tree({ 'node_modules/x': 'x', 'a.txt': 'a' });
        const missing = await explainPath(root, 'nope/file');
        expect(missing).toMatchObject({ decision: 'not-found', type: null, reason: null });
        const under = await explainPath(root, 'node_modules/ghost');
        expect(under).toMatchObject({
            decision: 'excluded',
            type: null,
            reason: { source: 'default' },
        });
        expect(under.notes.map((n) => n.code)).toContain('not-found');
        const res = await cli(['explain', 'nope'], { cwd: root });
        expect(res.code).toBe(0);
        expect(res.stdout).toContain('nope: not found');
    });

    it('30: paths outside the root are errors', async () => {
        const root = await tree({ 'in/a': 'a' });
        await expect(explainPath(join(root, 'in'), '../a')).rejects.toThrow(/outside the root/);
        const outside = await cli(['explain', '../elsewhere', '--root', 'in'], { cwd: root });
        expect(outside.code).toBe(1);
        expect(outside.stderr).toContain('outside the root');
        const absolute = await cli(['explain', '/', '--root', root], { cwd: root });
        expect(absolute.code).toBe(1);
    });

    it('explains the root itself', async () => {
        const root = await tree({ a: 'a' });
        expect(await explainPath(root, '.')).toMatchObject({
            decision: 'included',
            path: '',
            type: 'directory',
        });
    });

    it.skipIf(isWindows)(
        '32: hostile names and rules are escaped for people, exact in JSON',
        async () => {
            const name = 'evil\u001b[31m.log';
            const rule = 'evil\u001b*';
            const root = await tree({ [name]: 'x', '.gitignore': `${rule}\n` });
            const human = await cli(['explain', name, '-g'], { cwd: root });
            expect(human.stdout).not.toContain('\u001b');
            expect(human.stdout).toContain('evil\\x1b[31m.log');
            const machine = await cli(['explain', name, '-g', '--json'], { cwd: root });
            const parsed = json<PathExplanation>(machine);
            expect(parsed.path).toBe(name);
            expect(parsed.reason?.rule).toBe(rule);
            const summary = await cli(['explain', '-g'], { cwd: root });
            expect(summary.stdout).not.toContain('\u001b');
        }
    );
});

describe('explainSkips (fixture 31 and totals)', () => {
    it('31: --limit caps listed entries; counts stay complete', async () => {
        const entries: Tree = {};
        for (let i = 0; i < 20; i++) entries[`f${String(i).padStart(2, '0')}.log`] = 'x';
        const root = await tree(entries);
        const result = await skips(root, { exclude: ['*.log'], limit: 2 });
        expect(result.groups).toEqual([
            {
                source: 'pattern',
                file: null,
                line: null,
                rule: '*.log',
                index: 0,
                limit: null,
                count: 20,
                entries: ['f00.log', 'f01.log'],
                truncated: true,
            },
        ]);
        expect(renderSkipsExplanation(result)).toContain('… and 18 more');
        await expect(explainSkips(root, { limit: 1001 })).rejects.toThrow(/limit/);
        const tooMany = await cli(['explain', '--limit', '5000'], { cwd: root });
        expect(tooMany.code).toBe(1);
    });

    it('groups each source and matches the analysis summary', async () => {
        const root = await tree({
            '.gitignore': '*.log\nbuild/\n',
            'node_modules/a': 'a',
            '.git/HEAD': 'ref',
            'a.log': 'a',
            'b.log': 'b',
            'build/x': 'x',
            'small.txt': { size: 1 },
            'big.txt': { size: 5000 },
        });
        const result = await skips(root, { gitignore: true, minSize: 10 });
        expect(result.totals).toMatchObject({ excluded: 5, filtered: 1 });
        expect(result.groups[0]).toMatchObject({
            source: 'gitignore',
            line: 1,
            count: 2,
            entries: ['a.log', 'b.log'],
        });
        expect(result.groups.map((g) => g.source).toSorted()).toEqual(
            ['default', 'default', 'gitignore', 'gitignore', 'size'].toSorted()
        );
        const text = renderSkipsExplanation(result);
        expect(text).toContain('Skipped: 5 entries excluded, 1 file filtered');
        expect(text).toContain('.gitignore:1  *.log');
        expect(text).toContain('Sizes inside skipped directories are unknown');
    });

    it('reports a clean scan', async () => {
        const root = await tree({ a: 'a' });
        const res = await cli(['explain'], { cwd: root });
        expect(res.code).toBe(0);
        expect(res.stdout).toContain('Nothing was skipped');
        const data = json(await cli(['explain', '--json'], { cwd: root }));
        expect(data).toMatchObject({ explainVersion: 1, groups: [], totals: { excluded: 0 } });
    });

    it.skipIf(isWindows)('lists symbolic links that were not followed', async () => {
        const root = await tree({ 'real/a': 'a', link: { symlink: 'real' } });
        const result = await skips(root);
        expect(result.groups).toMatchObject([{ source: 'symlink', count: 1, entries: ['link'] }]);
    });

    it('dat ./explain still analyzes a directory named explain', async () => {
        const root = await tree({ 'explain/a.txt': 'a' });
        const res = await cli(['./explain', '--json'], { cwd: root });
        expect(res.code).toBe(0);
        expect(json(res)['summary']).toMatchObject({ files: 1 });
    });

    it('explains against another root with --root', async () => {
        const root = await tree({ 'proj/node_modules/x': 'x' });
        const res = await cli(['explain', 'proj/node_modules/x', '--root', 'proj', '--json'], {
            cwd: root,
        });
        expect(json(res)).toMatchObject({ decision: 'excluded', path: 'node_modules/x' });
        await writeFile(join(root, 'proj', 'y'), 'y');
        await utimes(join(root, 'proj', 'y'), new Date(2000, 0, 1), new Date(2000, 0, 1));
        const old = await cli(
            ['explain', 'proj/y', '--root', 'proj', '--newer-than', '2001-01-01'],
            { cwd: root }
        );
        expect(old.stdout).toContain('filtered');
        expect(old.stdout).toContain('--newer-than');
    });
});

describe('symlink to a directory without -L inside a path', () => {
    it.skipIf(isWindows)('stops at the link', async () => {
        const root = await tree({ 'real/a': 'a' });
        await symlink('real', join(root, 'link'));
        const result = await explain(root, 'link/a');
        expect(result).toMatchObject({
            decision: 'skipped',
            reason: { source: 'symlink', at: 'link', ancestor: true },
        });
    });
});

describe.skipIf(!hasGit || isWindows)('explain parity on random repositories', () => {
    // prettier-ignore
    const RULES = ['*.log', '!keep.log', 'build/', '!build/keep/', 'a*', '/top.txt', 'sub/', '**/deep/*.txt',
        'x?.bin', '[ab]*.txt', 'docs/**', '!docs/keep.md', 'dir/', '!*.md', 'n*/', '*.txt', '!c.txt', 'deep',
        '/sub/deep/', 'keep/', '!sub/', '*', '!*/', '!b.txt'];
    const DIRS = ['', 'build', 'build/keep', 'sub', 'sub/deep', 'docs', 'dir', 'nx', 'nx/deep'];
    const FILES = ['keep.log', 'a.log', 'top.txt', 'b.txt', 'x1.bin', 'ok.md', 'keep.md', 'c.txt'];
    /** Raise with DAT_EXPLAIN_REPOS for a longer local run. */
    const REPOS = Number(process.env['DAT_EXPLAIN_REPOS'] ?? 60);

    it(
        'matches the scanner and git check-ignore -v on every file',
        { timeout: 60_000 },
        async () => {
            let state = 12345;
            const random = (n: number): number => {
                state = (state * 1103515245 + 12345) & 0x7fffffff;
                return state % n;
            };
            const pick = (n: number): string[] =>
                Array.from({ length: n }, () => RULES[random(RULES.length)]!);
            const mismatches: string[] = [];
            let compared = 0;
            for (let repo = 0; repo < REPOS; repo++) {
                const entries: Tree = { '.gitignore': `${pick(1 + random(4)).join('\n')}\n` };
                const files: string[] = [];
                for (const dir of DIRS) {
                    for (const file of FILES) {
                        if (random(3) !== 0) continue;
                        const path = dir ? `${dir}/${file}` : file;
                        entries[path] = 'x';
                        files.push(path);
                    }
                    if (dir && random(4) === 0) {
                        entries[`${dir}/.gitignore`] = `${pick(1 + random(3)).join('\n')}\n`;
                    }
                }
                const root = await tree(entries);
                spawnSync('git', ['init', '-q'], { cwd: root, env: gitEnv });
                spawnSync('git', ['config', 'core.ignorecase', 'false'], {
                    cwd: root,
                    env: gitEnv,
                });
                await writeFile(
                    join(root, '.git', 'info', 'exclude'),
                    `${pick(random(2)).join('\n')}\n`
                );
                const counted = await scanned(root, { gitignore: true });
                const rules = gitRules(root, files);
                for (const [k, path] of files.entries()) {
                    compared++;
                    const result = await explainPath(root, path, { gitignore: true });
                    if ((result.decision === 'included') !== counted.has(path)) {
                        mismatches.push(`scanner ${repo} ${path}`);
                    }
                    const git = rules[k];
                    const gitExcluded =
                        git !== null && git !== undefined && !git.pattern.startsWith('!');
                    if ((result.decision === 'excluded') !== gitExcluded) {
                        mismatches.push(`git verdict ${repo} ${path}`);
                    } else if (
                        gitExcluded &&
                        (result.reason?.file !== git.file || result.reason?.line !== git.line)
                    ) {
                        mismatches.push(
                            `git rule ${repo} ${path}: dat ${result.reason?.file}:${result.reason?.line}, git ${git.file}:${git.line}`
                        );
                    }
                }
                const summary = await explainSkips(root, { gitignore: true });
                const analysis = await analyze(root, { gitignore: true });
                if (summary.totals.excluded !== analysis.summary.excluded) {
                    mismatches.push(`totals ${repo}`);
                }
            }
            expect(compared).toBeGreaterThan(REPOS * 5);
            expect(mismatches).toEqual([]);
        }
    );
});
