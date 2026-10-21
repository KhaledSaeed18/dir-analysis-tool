import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { CliIO } from '../../src/cli/io.ts';
import { CANCEL, Prompter } from '../../src/cli/prompt.ts';

class Capture extends Writable {
    text = '';
    override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
        this.text += chunk.toString();
        callback();
    }
}

function prompter(lines: string[], options: { end?: boolean; signal?: AbortSignal } = {}) {
    const stdin = new PassThrough();
    const stdout = new Capture();
    const io: CliIO = {
        stdout,
        stderr: new Capture(),
        stdinIsTTY: true,
        stdin,
        env: { NO_COLOR: '1' },
        cwd: process.cwd(),
        signal: options.signal,
    };
    for (const line of lines) stdin.write(`${line}\n`);
    if (options.end ?? true) stdin.end();
    return { p: new Prompter(io), stdout, stdin };
}

describe('Prompter', () => {
    it('reads text answers, applying defaults and showing the placeholder', async () => {
        const { p, stdout } = prompter(['  hello ', '']);
        expect(await p.text({ message: 'Name', placeholder: 'e.g. Ada' })).toBe('hello');
        expect(await p.text({ message: 'Count', defaultValue: '10' })).toBe('10');
        p.close();
        expect(stdout.text).toContain('? Name (e.g. Ada) › ');
        expect(stdout.text).toContain('? Count › ');
    });

    it('re-asks when validation fails', async () => {
        const { p, stdout } = prompter(['abc', '42']);
        const value = await p.text({
            message: 'Number',
            validate: (v) => (/^\d+$/.test(v) ? undefined : 'Digits only.'),
        });
        p.close();
        expect(value).toBe('42');
        expect(stdout.text).toContain('✖ Digits only.');
        expect(stdout.text.match(/\? Number/g)).toHaveLength(2);
    });

    it('understands yes/no answers and falls back to the initial value', async () => {
        const { p, stdout } = prompter(['y', 'NO', '', '', 'maybe', 'yes']);
        expect(await p.confirm({ message: 'A' })).toBe(true);
        expect(await p.confirm({ message: 'B' })).toBe(false);
        expect(await p.confirm({ message: 'C', initialValue: false })).toBe(false);
        expect(await p.confirm({ message: 'D' })).toBe(true);
        expect(await p.confirm({ message: 'E' })).toBe(true);
        p.close();
        expect(stdout.text).toContain('? A (Y/n) › ');
        expect(stdout.text).toContain('? C (y/N) › ');
        expect(stdout.text).toContain('Please answer yes or no.');
    });

    it('cancels when stdin closes', async () => {
        const { p } = prompter(['first']);
        expect(await p.text({ message: 'One' })).toBe('first');
        expect(await p.text({ message: 'Two' })).toBe(CANCEL);
        expect(await p.confirm({ message: 'Three' })).toBe(CANCEL);
        p.close();
    });

    it('cancels when the CLI is aborted', async () => {
        const controller = new AbortController();
        const { p } = prompter([], { end: false, signal: controller.signal });
        const pending = p.text({ message: 'Wait' });
        controller.abort();
        expect(await pending).toBe(CANCEL);
        p.close();
    });

    it('prints intro, outro and cancel lines', () => {
        const { p, stdout } = prompter([]);
        p.intro('title');
        p.outro('done');
        p.cancel('stopped');
        p.close();
        expect(stdout.text).toBe('\ntitle\n\n\n✔ done\n\n■ stopped\n');
    });
});
