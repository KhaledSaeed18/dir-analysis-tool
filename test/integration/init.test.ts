import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { cli } from '../helpers/cli.ts';
import { fixture } from '../helpers/fixture.ts';

/** A stdin that answers each question in turn, then closes (which cancels any further question). */
function answers(...lines: string[]): PassThrough {
    const stdin = new PassThrough();
    for (const line of lines) stdin.write(`${line}\n`);
    stdin.end();
    return stdin;
}

describe('dat init (interactive)', () => {
    it('writes the answers as a config file', async () => {
        const root = await fixture({});
        const result = await cli(['init', root], {
            stdinTTY: true,
            stdin: answers(
                'coverage/, *.log',
                'y',
                'lots',
                '50MB',
                'yes',
                'x',
                '7',
                'size<1k, nope',
                'size<=1GB, duplicates=0'
            ),
        });
        expect(result.code).toBe(0);
        expect(result.stdout).toContain(
            '? Patterns to exclude (comma-separated, gitignore syntax) (coverage/, *.log, tmp/) › '
        );
        expect(result.stdout).toMatch(/Invalid size/);
        expect(result.stdout).toMatch(/whole number/);
        expect(result.stdout).toMatch(/Invalid budget/);
        expect(result.stdout).toContain('Done. Run "dat"');
        const config = JSON.parse(
            await readFile(join(root, '.dir-analyzer.json'), 'utf8')
        ) as Record<string, unknown>;
        expect(config).toEqual({
            $schema: 'https://unpkg.com/dir-analysis-tool@3/schema.json',
            exclude: ['coverage/', '*.log'],
            gitignore: true,
            largeFiles: '50MB',
            duplicates: true,
            top: 7,
            budgets: ['size<=1GB', 'duplicates=0'],
        });
    });

    it('asks before overwriting, and writes nothing when cancelled', async () => {
        const root = await fixture({});
        const file = join(root, '.dir-analyzer.json');
        await writeFile(file, '{"top":1}\n');
        const kept = await cli(['init', root], { stdinTTY: true, stdin: answers('n') });
        expect(kept.code).toBe(0);
        expect(kept.stdout).toContain('Kept the existing file.');
        expect(await readFile(file, 'utf8')).toBe('{"top":1}\n');

        const cancelled = await cli(['init', root], { stdinTTY: true, stdin: answers('y') });
        expect(cancelled.code).toBe(0);
        expect(cancelled.stdout).toContain('Cancelled. Nothing was written.');
        expect(await readFile(file, 'utf8')).toBe('{"top":1}\n');

        const forced = await cli(['init', root, '--force'], {
            stdinTTY: true,
            stdin: answers('', 'n', '', '', '', ''),
        });
        expect(forced.code).toBe(0);
        expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
            gitignore: false,
            top: 10,
        });
    });
});
