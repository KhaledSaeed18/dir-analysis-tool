import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { AnalysisResult, ComparisonResult } from '../../src/types.ts';
import { VERSION } from '../../src/version.ts';
import { cli, json } from '../helpers/cli.ts';
import { bytes, fixture } from '../helpers/fixture.ts';

const exec = promisify(execFile);

describe('dat (analyze)', () => {
    it('is the default command and prints a readable report', async () => {
        const root = await fixture({ 'a.txt': 'hello', 'src/b.ts': 'x' });
        const result = await cli([root]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Files     2');
        expect(result.stdout).toContain('Largest files');
        expect(result.stdout).not.toContain('\u001B[');
        expect(result.stderr).toBe('');
    });

    it('prints clean JSON on stdout and nothing else (v2 mixed in other text)', async () => {
        const root = await fixture({ 'a.txt': 'hello', 'b.txt': 'hello' });
        const csv = join(root, 'out.csv');
        const result = await cli([root, '--json', '-d', '--csv', csv], { cwd: root });
        expect(result.code).toBe(0);
        const data = json<AnalysisResult>(result);
        expect(data.summary.files).toBe(2);
        expect(data.duplicates?.count).toBe(1);
        expect(data.tree).toBeUndefined(); // only with --tree
        expect(result.stderr).toContain('CSV written');
        expect(await readFile(csv, 'utf8')).toContain('duplicate,');
    });

    it('does not let -l swallow the directory argument', async () => {
        const root = await fixture({ 'big.bin': bytes(2048) });
        const result = await cli(['-l', root, '--json']);
        expect(json<AnalysisResult>(result).largeFiles?.threshold).toBe(100 * 1024 * 1024);
        const sized = await cli(['-l', '1k', root, '--json']);
        expect(json<AnalysisResult>(sized).largeFiles?.count).toBe(1);
    });

    it('reads a bare --large-files number as MiB, like v2', async () => {
        const root = await fixture({ 'big.bin': bytes(2 * 1024 * 1024), 'small.bin': bytes(10) });
        const result = await cli([root, '-l', '1', '--json']);
        expect(json<AnalysisResult>(result).largeFiles).toMatchObject({
            threshold: 1024 * 1024,
            count: 1,
        });
        expect(result.stderr).toContain('read as 1 MiB');
    });

    it('applies file exclusions (broken in v2)', async () => {
        const root = await fixture({ 'a.log': 'x', 'b.txt': 'x', 'logs/c.log': 'x' });
        const result = await cli([root, '-e', '*.log', '--json']);
        expect(json<AnalysisResult>(result).summary.files).toBe(1);
    });

    it.each([
        ['--top', 'abc'],
        ['--top', '-1'],
        ['-l', '5 parsecs'],
        ['--min-size', 'big'],
        ['--newer-than', 'whenever'],
        ['--budget', 'speed<1'],
        ['--format', 'xml'],
        ['--unknown-flag'],
    ])(
        'rejects %s %s instead of ignoring it (v2 ignored bad values)',
        async (...args: string[]) => {
            const root = await fixture({ a: 'x' });
            const result = await cli([root, ...args]);
            expect(result.code).toBe(1);
            expect(result.stderr).toMatch(/error/i);
            expect(result.stdout).toBe('');
        }
    );

    it('keeps the last value of a repeated numeric option (v2 used it as a radix)', async () => {
        const root = await fixture({
            a: 'a',
            b: 'bb',
            c: 'ccc',
            d: 'dddd',
            e: 'eeeee',
            f: 'ffffff',
        });
        const result = await cli([root, '--top', '3', '--top', '5', '--json']);
        expect(json<AnalysisResult>(result).largestFiles).toHaveLength(5);
    });

    it('fails with a clear message for a missing directory', async () => {
        const result = await cli(['/definitely/not/here']);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('No such directory');
    });

    it('exits with code 2 when a budget fails, and says why on stderr', async () => {
        const root = await fixture({ 'a.bin': bytes(4096) });
        const pass = await cli([root, '-b', 'size<=1MB', '--json']);
        expect(pass.code).toBe(0);
        const fail = await cli([root, '-b', 'size<1k', '-b', 'files<10', '--json']);
        expect(fail.code).toBe(2);
        expect(fail.stderr).toContain('budget failed size<1k (actual 4 KiB)');
        expect(json<AnalysisResult>(fail).budgets).toHaveLength(2);
        const pretty = await cli([root, '-b', 'size<1k']);
        expect(pretty.code).toBe(2);
        expect(pretty.stdout).toContain('Budgets');
    });

    it('writes reports to files', async () => {
        const root = await fixture({ 'a.txt': 'x' });
        const result = await cli(
            [root, '-o', 'reports/out.md', '-f', 'markdown', '--html', 'report.html'],
            { cwd: root }
        );
        expect(result.code).toBe(0);
        expect(result.stdout).toBe('');
        expect(await readFile(join(root, 'reports', 'out.md'), 'utf8')).toMatch(
            /^## Directory analysis/
        );
        expect(await readFile(join(root, 'report.html'), 'utf8')).toMatch(/^<!doctype html>/);
        expect(result.stderr).toContain('report.html');
        const quiet = await cli([root, '-q', '-o', 'q.json', '-f', 'json'], { cwd: root });
        expect(quiet.stderr).toBe('');
    });

    it('writes HTML to a file instead of a terminal', async () => {
        const root = await fixture({ 'a.txt': 'x' });
        const result = await cli([root, '-f', 'html'], { cwd: root, tty: true });
        expect(result.stdout).toBe('');
        expect(result.stderr).toMatch(
            /Report written to directory-analysis-\d{4}-\d{2}-\d{2}\.html/
        );
        const piped = await cli([root, '-f', 'html'], { cwd: root });
        expect(piped.stdout).toMatch(/^<!doctype html>/);
    });

    it('shows a progress line only on an interactive stderr', async () => {
        const root = await fixture({ 'a.txt': 'x' });
        const tty = await cli([root, '--json'], { tty: true, env: { NO_COLOR: '1' } });
        expect(() => json(tty)).not.toThrow();
        const none = await cli([root, '--json', '--no-progress'], { tty: true });
        expect(none.stderr).toBe('');
    });

    it('colors output only when asked or when the terminal supports it', async () => {
        const root = await fixture({ 'a.txt': 'x' });
        expect((await cli([root, '--color'])).stdout).toContain('\u001B[');
        expect(
            (
                await cli([root], {
                    tty: true,
                    env: { NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: 'xterm' },
                })
            ).stdout
        ).toContain('\u001B[');
        expect(
            (await cli([root, '--no-color'], { tty: true, env: { NO_COLOR: undefined } })).stdout
        ).not.toContain('\u001B[');
    });
});

describe('configuration', () => {
    it('discovers config from the analyzed directory and lets flags win', async () => {
        const root = await fixture({
            '.dir-analyzer.json': JSON.stringify({ top: 1, exclude: ['*.log'], duplicates: true }),
            'a.txt': 'aaa',
            'b.txt': 'bb',
            'c.log': 'c',
        });
        const fromConfig = json<AnalysisResult>(await cli([root, '--json']));
        expect(fromConfig.largestFiles).toHaveLength(1);
        expect(fromConfig.duplicates).toBeDefined();
        expect(fromConfig.summary.files).toBe(3); // a, b, and the config file itself
        const overridden = json<AnalysisResult>(
            await cli([root, '--json', '--top', '2', '--no-duplicates'])
        );
        expect(overridden.largestFiles).toHaveLength(2);
        expect(overridden.duplicates).toBeUndefined();
        const ignored = json<AnalysisResult>(await cli([root, '--json', '--no-config']));
        expect(ignored.summary.files).toBe(4);
    });

    it('loads an explicit config file (broken in v2)', async () => {
        const root = await fixture({
            'x.txt': 'x',
            'y.txt': 'yy',
            'conf/custom.json': JSON.stringify({ top: 1 }),
        });
        const result = await cli([root, '-c', join(root, 'conf', 'custom.json'), '--json']);
        expect(json<AnalysisResult>(result).largestFiles).toHaveLength(1);
    });

    it('warns about legacy keys and rejects invalid files', async () => {
        const root = await fixture({
            '.dir-analyzer.json': JSON.stringify({ topN: 1 }),
            a: 'a',
            b: 'b',
        });
        const legacy = await cli([root, '--json']);
        expect(legacy.code).toBe(0);
        expect(legacy.stderr).toContain('"topN" is deprecated; use "top" instead');
        await writeFile(join(root, '.dir-analyzer.json'), JSON.stringify({ top: 'lots' }));
        const invalid = await cli([root]);
        expect(invalid.code).toBe(1);
        expect(invalid.stderr).toContain('"top" must be an integer');
    });
});

describe('dat compare', () => {
    it('compares two directories', async () => {
        const root = await fixture({ 'a/x.txt': 'x', 'b/x.txt': 'xx', 'b/y.txt': 'y' });
        const result = await cli(['compare', 'a', 'b', '--json'], { cwd: root });
        expect(result.code).toBe(0);
        const data = json<ComparisonResult>(result);
        expect(data.added.count).toBe(1);
        expect(data.changed.count).toBe(1);
        const pretty = await cli(['compare', 'a', 'b', '--content', '-n', '1'], { cwd: root });
        expect(pretty.stdout).toContain('Added');
        const md = await cli(['compare', 'a', 'b', '-f', 'markdown', '-o', 'diff.md'], {
            cwd: root,
        });
        expect(md.code).toBe(0);
        expect(await readFile(join(root, 'diff.md'), 'utf8')).toContain('## Directory comparison');
        const bad = await cli(['compare', 'a', 'b', '-f', 'html'], { cwd: root });
        expect(bad.code).toBe(1);
    });
});

describe('dat init', () => {
    it('writes a starter config with --yes and refuses to overwrite without --force', async () => {
        const root = await fixture({});
        const first = await cli(['init', root, '--yes']);
        expect(first.code).toBe(0);
        const config = JSON.parse(
            await readFile(join(root, '.dir-analyzer.json'), 'utf8')
        ) as Record<string, unknown>;
        expect(config['$schema']).toContain('schema.json');
        const again = await cli(['init', root, '--yes']);
        expect(again.code).toBe(1);
        expect(again.stderr).toContain('already exists');
        expect((await cli(['init', root, '--yes', '--force'])).code).toBe(0);
        const analyzed = await cli([root, '--json']);
        expect(analyzed.code).toBe(0);
    });

    it('explains how to proceed when not interactive', async () => {
        const root = await fixture({});
        const result = await cli(['init', root]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('--yes');
    });
});

describe('dat (meta)', () => {
    it('prints the version and help', async () => {
        const version = await cli(['--version']);
        expect(version.code).toBe(0);
        expect(version.stdout.trim()).toBe(VERSION);
        const help = await cli(['--help']);
        expect(help.code).toBe(0);
        expect(help.stdout).toContain('Exit codes');
        const analyzeHelp = await cli(['analyze', '--help']);
        expect(analyzeHelp.stdout).toContain('Scan options:');
        expect(analyzeHelp.stdout).toContain('Examples:');
    });

    it('reports interruption with exit code 130', async () => {
        const root = await fixture({ a: 'x' });
        const controller = new AbortController();
        controller.abort();
        const result = await cli([root], { signal: controller.signal });
        expect(result.code).toBe(130);
        expect(result.stderr).toContain('interrupted');
    });

    it('runs as a real process and exits cleanly when the pipe closes early', async () => {
        const root = await fixture({ 'a.txt': 'x' });
        const main = join(import.meta.dirname, '../../src/cli/main.ts');
        const { stdout } = await exec(process.execPath, [main, root, '--json']);
        expect((JSON.parse(stdout) as AnalysisResult).summary.files).toBe(1);
        const failing = await exec(process.execPath, [main, join(root, 'missing')]).catch(
            (e: { code: number; stderr: string }) => e
        );
        expect(failing).toMatchObject({ code: 1 });
    });
});
