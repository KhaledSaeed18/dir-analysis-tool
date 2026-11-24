import { chmod, mkdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cli } from '../helpers/cli.ts';
import { fixture, isRoot, isWindows } from '../helpers/fixture.ts';

const FOOTER = 'Please report unexpected errors';

/** A tree to scan and a working folder with an existing directory and file to write into. */
async function setup(): Promise<{ root: string; cwd: string }> {
    const root = await fixture({ 'a.txt': 'x' });
    const cwd = await fixture({ 'outdir/keep.txt': 'x', 'afile.txt': 'x' });
    return { root, cwd };
}

describe('report files that cannot be written (#25)', () => {
    // --html and --csv take a value only when it ends in .html/.htm or .csv.
    it.each([
        [['-o', 'outdir'], 'the report to outdir: it is a directory'],
        [['--html', 'outdir.html'], 'the HTML report to outdir.html: it is a directory'],
        [['--csv', 'outdir.csv'], 'the CSV export to outdir.csv: it is a directory'],
        [['--csv', 'x.csv', '-o', 'outdir'], 'the report to outdir: it is a directory'],
        [['-o', 'afile.txt/r.txt'], 'the report to afile.txt/r.txt: afile.txt is not a directory'],
    ])('dat %j fails with one plain error, before scanning', async (args, message) => {
        const { root, cwd } = await setup();
        await mkdir(join(cwd, 'outdir.html'));
        await mkdir(join(cwd, 'outdir.csv'));
        const result = await cli([root, ...args, '--no-config'], { cwd });
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        // Paths in messages use the platform's separator.
        expect(result.stderr).toContain(`error Cannot write ${message.replace('/', sep)}`);
        expect(result.stderr).not.toContain(FOOTER);
        // Checked before the scan: no file of the run was written.
        expect(result.stderr).not.toContain('written');
    });

    it('suggests a file name of the right kind for a directory', async () => {
        const { root, cwd } = await setup();
        await mkdir(join(cwd, 'outdir.html'));
        const result = await cli([root, '--html', 'outdir.html', '--no-config'], { cwd });
        expect(result.stderr).toContain(
            `Give a file name, for example ${join('outdir.html', 'report.html')}.`
        );
    });

    it('checks the output before scanning, so a missing root is not reached', async () => {
        const { cwd } = await setup();
        const result = await cli([join(cwd, 'missing'), '-o', 'outdir', '--no-config'], { cwd });
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('Cannot write the report to outdir: it is a directory');
        expect(result.stderr).not.toContain('No such directory');
    });

    it.skipIf(isWindows || isRoot)('says permission denied for a read-only folder', async () => {
        const { root, cwd } = await setup();
        await mkdir(join(cwd, 'ro'));
        await chmod(join(cwd, 'ro'), 0o555);
        try {
            for (const [args, what] of [
                [['-o', 'ro/r.txt'], 'the report to ro/r.txt'],
                [['--csv', 'ro/r.csv'], 'the CSV export to ro/r.csv'],
                [['-o', 'ro/new/r.txt'], 'the report to ro/new/r.txt'],
            ] as const) {
                const result = await cli([root, ...args, '--no-config'], { cwd });
                expect(result.code).toBe(1);
                expect(result.stderr).toContain(`error Cannot write ${what}: permission denied`);
                expect(result.stderr).not.toContain(FOOTER);
            }
        } finally {
            await chmod(join(cwd, 'ro'), 0o755);
        }
    });

    it('still creates missing folders for a new report file', async () => {
        const { root, cwd } = await setup();
        const result = await cli([root, '-o', 'new/sub/r.txt', '--no-config'], { cwd });
        expect(result.code).toBe(0);
        expect(await readFile(join(cwd, 'new', 'sub', 'r.txt'), 'utf8')).toContain('a.txt');
    });

    it('checks compare and watch outputs before they start', async () => {
        const { root, cwd } = await setup();
        for (const args of [
            ['compare', root, root, '-o', 'outdir'],
            ['watch', root, '-o', 'outdir'],
        ]) {
            const result = await cli([...args, '--no-config'], { cwd });
            expect(result.code).toBe(1);
            expect(result.stderr.trim()).toBe(
                `error Cannot write the report to outdir: it is a directory\nGive a file name, for example ${join('outdir', 'report.txt')}.`
            );
        }
    });

    it('dat init says when its directory is a file', async () => {
        const { cwd } = await setup();
        const result = await cli(['init', 'afile.txt', '-y'], { cwd });
        expect(result.code).toBe(1);
        expect(result.stderr.trim()).toBe('error dat init: afile.txt is not a directory');
        expect(await readFile(join(cwd, 'afile.txt'), 'utf8')).toBe('x');
    });

    it.skipIf(isWindows)('escapes control characters in the path it names', async () => {
        const { root, cwd } = await setup();
        await mkdir(join(cwd, 'evil\u001b[2J'));
        const result = await cli([root, '-o', 'evil\u001b[2J', '--no-config'], { cwd });
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('evil\\x1b[2J');
        expect(result.stderr).not.toContain('\u001b');
    });
});
