import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TreeWatcher } from '../../src/cli/watcher.ts';
import { Excluder } from '../../src/core/exclude.ts';
import { listDirectories } from '../../src/core/options.ts';
import type { AnalysisResult } from '../../src/types.ts';
import { cli } from '../helpers/cli.ts';
import { fixture } from '../helpers/fixture.ts';

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
        .map((line) => JSON.parse(line) as AnalysisResult);

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
        expect(result.code).toBe(0);
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
        expect(result.code).toBe(0);
        expect(result.stderr).toContain('watching');
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
