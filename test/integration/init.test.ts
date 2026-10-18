import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cli } from '../helpers/cli.ts';
import { fixture } from '../helpers/fixture.ts';

const CANCEL = Symbol('cancel');
const answers: unknown[] = [];
const validators: Array<(value: string) => string | undefined> = [];

vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    isCancel: (value: unknown) => value === CANCEL,
    confirm: vi.fn(async () => answers.shift()),
    text: vi.fn(async (options: { validate?: (value: string) => string | undefined }) => {
        if (options.validate) validators.push(options.validate);
        return answers.shift();
    }),
}));

beforeEach(() => {
    answers.length = 0;
    validators.length = 0;
});

describe('dat init (interactive)', () => {
    it('writes the answers as a config file', async () => {
        const root = await fixture({});
        answers.push('coverage/, *.log', true, '50MB', true, '7', 'size<=1GB, duplicates=0');
        const result = await cli(['init', root], { stdinTTY: true });
        expect(result.code).toBe(0);
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
        const [large, top, budgets] = validators;
        expect(large!('lots')).toMatch(/Invalid size/);
        expect(large!('')).toBeUndefined();
        expect(top!('x')).toMatch(/whole number/);
        expect(budgets!('size<1k, nope')).toMatch(/Invalid budget/);
        expect(budgets!('size<1k')).toBeUndefined();
    });

    it('asks before overwriting, and writes nothing when cancelled', async () => {
        const root = await fixture({});
        const file = join(root, '.dir-analyzer.json');
        await writeFile(file, '{"top":1}\n');
        answers.push(false);
        expect((await cli(['init', root], { stdinTTY: true })).code).toBe(0);
        expect(await readFile(file, 'utf8')).toBe('{"top":1}\n');

        answers.push(true, CANCEL);
        expect((await cli(['init', root], { stdinTTY: true })).code).toBe(0);
        expect(await readFile(file, 'utf8')).toBe('{"top":1}\n');

        answers.push('', false, '', false, '', '');
        expect((await cli(['init', root, '--force'], { stdinTTY: true })).code).toBe(0);
        expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
            gitignore: false,
            top: 10,
        });
    });
});
