import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TreeWatcher } from '../../src/cli/watcher.ts';
import { Excluder } from '../../src/core/exclude.ts';
import { listDirectories } from '../../src/core/options.ts';
import type { AnalysisResult } from '../../src/types.ts';
import { cli } from '../helpers/cli.ts';
import { fixture } from '../helpers/fixture.ts';
import { assertValidReport } from '../helpers/report-schema.ts';

function waitFor(check: () => boolean, timeout = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
            if (check()) {
                clearInterval(timer);
                resolve();
            } else if (Date.now() - started > timeout) {
                clearInterval(timer);
                reject(new Error('timed out'));
            }
        }, 20);
    });
}

const lines = (text: string): AnalysisResult[] =>
    text
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const report: unknown = JSON.parse(line);
            assertValidReport(report);
            return report as AnalysisResult;
        });

describe('dat watch', () => {
    it('re-analyzes on changes and prints one JSON document per run', async () => {
        const root = await fixture({ 'a.txt': 'x', 'node_modules/dep.js': 'x' });
        const controller = new AbortController();
        let output = '';
        const running = cli(['watch', root, '--json', '--debounce', '50'], {
            signal: controller.signal,
            onStdout: (text) => (output = text),
        });
        await waitFor(() => lines(output).length === 1);
        await writeFile(join(root, 'b.txt'), 'yy');
        await waitFor(() => lines(output).at(-1)?.summary.files === 2);
        controller.abort();
        const result = await running;
        expect(result.code).toBe(130);
        expect(result.stderr).toContain('interrupted');
        expect(lines(result.stdout)[0]!.summary.files).toBe(1);
    });

    it('polls on an interval and prints only when something changed', async () => {
        const root = await fixture({ 'a.txt': 'x' });
        const controller = new AbortController();
        let output = '';
        const running = cli(['watch', root, '--poll', '1', '--no-clear'], {
            signal: controller.signal,
            onStdout: (text) => (output = text),
        });
        await waitFor(() => output.includes('Files     1'));
        await new Promise((resolve) => setTimeout(resolve, 1300));
        expect(output.match(/Files {5}/g)).toHaveLength(1);
        await writeFile(join(root, 'b.txt'), 'y');
        await waitFor(() => output.includes('Files     2'));
        controller.abort();
        const result = await running;
        expect(result.code).toBe(130);
        expect(result.stderr).toContain('watching');
    });

    it.each([
        ['is missing', (root: string) => join(root, 'missing'), 'No such directory'],
        ['is a file', (root: string) => join(root, 'a.txt'), 'Not a directory'],
    ])('exits 1 with one error line when the root %s', async (_name, path, message) => {
        const root = await fixture({ 'a.txt': 'x' });
        for (const mode of [[], ['--poll', '1']]) {
            const result = await cli(['watch', path(root), '--json', ...mode]);
            expect(result.code).toBe(1);
            expect(result.stdout).toBe('');
            expect(result.stderr.trim().split('\n')).toEqual([`error ${message}: ${path(root)}`]);
        }
    });

    it.each([[[] as string[]], [['--poll', '1']]])(
        'waits for a deleted root and reports again once it is back (%j)',
        async (mode) => {
            const parent = await fixture({ 'w/a.txt': 'x' });
            const root = join(parent, 'w');
            const controller = new AbortController();
            let output = '';
            let errors = '';
            const running = cli(['watch', root, '--json', '--debounce', '50', ...mode], {
                signal: controller.signal,
                onStdout: (text) => (output = text),
                onStderr: (text) => (errors = text),
            });
            await waitFor(() => lines(output).length === 1);
            await rm(root, { recursive: true });
            await waitFor(() => errors.includes('was removed'));
            await new Promise((resolve) => setTimeout(resolve, 1500));
            await mkdir(root);
            await writeFile(join(root, 'b.txt'), 'yy');
            await waitFor(() => lines(output).at(-1)?.summary.bytes === 2);
            controller.abort();
            const result = await running;
            expect(result.code).toBe(130);
            expect(result.stderr.match(/was removed/g)).toHaveLength(1);
            expect(result.stderr).not.toContain('No such directory');
            expect(result.stderr).not.toContain('falling back');
        },
        20_000
    );

    it('ignores changes to its own -o file inside the watched folder', async () => {
        const root = await fixture({ 'a.txt': 'x' });
        const controller = new AbortController();
        let errors = '';
        const written = (): number => errors.match(/Report written/g)?.length ?? 0;
        const running = cli(
            ['watch', root, '-o', join(root, 'out', 'report.txt'), '--debounce', '50'],
            { signal: controller.signal, onStderr: (text) => (errors = text) }
        );
        await waitFor(() => written() === 1);
        await new Promise((resolve) => setTimeout(resolve, 500));
        await writeFile(join(root, 'b.txt'), 'y');
        await waitFor(() => written() >= 2);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const settled = written();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        controller.abort();
        const result = await running;
        expect(written()).toBe(settled);
        // The first write creates the out/ folder, which may cost one extra scan; never a loop.
        expect(settled).toBeLessThanOrEqual(3);
        expect(result.stdout).toBe('');
    }, 15_000);

    it('writes JSON reports to -o, rewriting the file on each change', async () => {
        const root = await fixture({ 'a.txt': 'x' });
        const out = join(await fixture({}), 'report.json');
        const controller = new AbortController();
        let errors = '';
        const running = cli(['watch', root, '-j', '-o', out, '--debounce', '50'], {
            signal: controller.signal,
            onStderr: (text) => (errors = text),
        });
        await waitFor(() => errors.includes('Report written'));
        const read = async (): Promise<AnalysisResult> => {
            const report: unknown = JSON.parse(await readFile(out, 'utf8'));
            assertValidReport(report);
            return report as AnalysisResult;
        };
        expect((await read()).summary.files).toBe(1);
        await writeFile(join(root, 'b.txt'), 'y');
        await waitFor(() => (errors.match(/Report written/g)?.length ?? 0) >= 2);
        controller.abort();
        const result = await running;
        expect(result.stdout).toBe('');
        expect((await read()).summary.files).toBe(2);
    });

    it('polls and reports changes that keep sizes and counts', async () => {
        // Twelve bigger files keep small.txt out of the largest-files list.
        const big = Object.fromEntries(
            Array.from({ length: 12 }, (_, i) => [`big${i}.bin`, 'x'.repeat(1000 + i)])
        );
        const root = await fixture({ ...big, 'small.txt': 'old' });
        const old = new Date('2020-01-01T00:00:00Z');
        await utimes(join(root, 'small.txt'), old, old);
        const controller = new AbortController();
        let output = '';
        const running = cli(['watch', root, '--poll', '1', '--stale', '1y', '--json'], {
            signal: controller.signal,
            onStdout: (text) => (output = text),
        });
        await waitFor(() => lines(output).length === 1);
        expect(lines(output)[0]!.staleFiles?.count).toBe(1);
        const now = new Date();
        await utimes(join(root, 'small.txt'), now, now);
        await waitFor(() => lines(output).length === 2);
        expect(lines(output)[1]!.staleFiles?.count).toBe(0);
        await new Promise((resolve) => setTimeout(resolve, 1300));
        controller.abort();
        const result = await running;
        // Relative cutoffs and timings move on every scan, but they alone are not a change.
        expect(lines(result.stdout)).toHaveLength(2);
    });
});

describe('TreeWatcher', () => {
    it.each([true, false])(
        'reports changes outside excluded paths (recursive: %s)',
        async (recursive) => {
            const root = await fixture({ 'src/a.ts': 'x', 'node_modules/x.js': 'x' });
            const excluder = new Excluder();
            const changes: string[] = [];
            const errors: Error[] = [];
            const watcher = new TreeWatcher({
                root,
                recursive,
                isIgnored: (rel) => excluder.isPathExcluded(rel),
                onChange: (rel) => changes.push(rel),
                onError: (error) => errors.push(error),
            });
            const dirs = await listDirectories(root);
            expect(dirs.sort()).toEqual(['', 'src']);
            watcher.sync(dirs);
            expect(watcher.recursive).toBe(recursive);
            await new Promise((resolve) => setTimeout(resolve, 100));
            await writeFile(join(root, 'node_modules', 'y.js'), 'y');
            await writeFile(join(root, 'src', 'b.ts'), 'y');
            await waitFor(() => changes.some((c) => c.startsWith('src')));
            expect(changes.some((c) => c.startsWith('node_modules'))).toBe(false);

            if (!recursive) {
                await mkdir(join(root, 'lib'));
                watcher.sync([...dirs, 'lib']);
                watcher.sync(['']);
                await rm(join(root, 'src'), { recursive: true });
            }
            watcher.close();
            watcher.sync(dirs); // no-op once closed
            expect(errors).toEqual([]);
        }
    );

    it('reports watchers that cannot be created', async () => {
        const root = await fixture({});
        const errors: Error[] = [];
        const watcher = new TreeWatcher({
            root,
            recursive: false,
            isIgnored: () => false,
            onChange: () => {},
            onError: (error) => errors.push(error),
        });
        watcher.sync(['does-not-exist']);
        watcher.close();
        expect(errors).toHaveLength(1);
    });
});
