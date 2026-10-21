import { describe, expect, it } from 'vitest';
import {
    Command,
    CommanderError,
    InvalidArgumentError,
    Option,
    suggestSimilar,
} from '../../src/cli/command.ts';

interface Harness {
    program: Command;
    out: () => string;
    err: () => string;
    parse: (argv: string[]) => Promise<{ code: number | undefined; opts: Record<string, unknown> }>;
    calls: unknown[][];
}

function integer(value: string): number {
    if (!/^\d+$/.test(value)) throw new InvalidArgumentError('Expected a whole number.');
    return Number(value);
}

/** A small program shaped like the real CLI: a default command plus one more. */
function harness(): Harness {
    let out = '';
    let err = '';
    const calls: unknown[][] = [];
    const program = new Command('dat')
        .description('A test program.')
        .version('1.2.3', '-v, --version', 'print the version')
        .helpOption('-h, --help', 'show help')
        .helpCommand('help [command]', 'show help for a command')
        .configureOutput({
            writeOut: (text) => (out += text),
            writeErr: (text) => (err += text),
            outputError: (text, write) => write(`[red]${text}`),
        })
        .showHelpAfterError('(see --help)')
        .showSuggestionAfterError(true)
        .exitOverride();

    const analyze = program
        .command('analyze', { isDefault: true })
        .description('analyze a directory')
        .argument('[directory]', 'directory to analyze', '.')
        .addOption(
            new Option('-e, --exclude <pattern>', 'skip (repeatable)')
                .helpGroup('Scan options:')
                .argParser((value: string, previous: string[] | undefined) => [
                    ...(previous ?? []),
                    value,
                ])
        )
        .addOption(new Option('-a, --all', 'include everything').helpGroup('Scan options:'))
        .addOption(new Option('-d, --duplicates', 'find duplicates').helpGroup('Report options:'))
        .addOption(new Option('-x, --extensions', 'show extensions').helpGroup('Report options:'))
        .addOption(
            new Option('--max-depth <n>', 'descend at most n levels')
                .helpGroup('Scan options:')
                .argParser(integer)
        )
        .addOption(
            new Option('-l, --large-files [size]', 'list large files')
                .helpGroup('Report options:')
                .argParser((value: string) => `size:${value}`)
        )
        .addOption(
            new Option('-f, --format <format>', 'output format')
                .helpGroup('Output options:')
                .choices(['pretty', 'json'])
        )
        .addOption(new Option('--color', 'force colors').helpGroup('Output options:'))
        .addOption(new Option('--no-color', 'disable colors').helpGroup('Output options:'))
        .addOption(new Option('--no-progress', 'hide progress').helpGroup('Output options:'))
        .addOption(new Option('--secret', 'not shown').hideHelp())
        .addHelpText('after', '\nExamples:\n  $ dat .\n');
    analyze.action((...args: unknown[]) => {
        calls.push(args);
    });

    program
        .command('compare')
        .description('compare two directories')
        .argument('<left>', 'baseline')
        .argument('<right>', 'other')
        .addOption(new Option('--content', 'compare contents'))
        .action((...args: unknown[]) => {
            calls.push(args);
        });

    program.addHelpText('after', '\nDocs: https://example.test');

    return {
        program,
        out: () => out,
        err: () => err,
        calls,
        parse: async (argv) => {
            let code: number | undefined;
            try {
                await program.parseAsync(argv, { from: 'user' });
            } catch (error) {
                if (!(error instanceof CommanderError)) throw error;
                code = error.exitCode;
            }
            return { code, opts: analyze.opts() };
        },
    };
}

describe('Command parsing', () => {
    it('runs the default command with positionals, options, and the command itself', async () => {
        const h = harness();
        const { code } = await h.parse(['./photos', '--all']);
        expect(code).toBeUndefined();
        const [directory, options, cmd] = h.calls[0]!;
        expect(directory).toBe('./photos');
        expect(options).toMatchObject({ all: true });
        expect(cmd).toBeInstanceOf(Command);
    });

    it('applies the positional default and reports sources only for typed options', async () => {
        const h = harness();
        await h.parse([]);
        expect(h.calls[0]![0]).toBe('.');
        const cmd = h.calls[0]![2] as Command;
        // A lone --no-progress defaults progress to true, but that is not a CLI source.
        expect(cmd.opts()['progress']).toBe(true);
        expect(cmd.getOptionValueSource('progress')).toBe('default');
        expect(cmd.getOptionValueSource('all')).toBeUndefined();
    });

    it('parses combined short booleans, -ovalue, --opt=value, and --opt value', async () => {
        const h = harness();
        const { opts } = await h.parse(['-adx', '-l1k', '--max-depth=2', '--format', 'json']);
        expect(opts).toMatchObject({
            all: true,
            duplicates: true,
            extensions: true,
            largeFiles: 'size:1k',
            maxDepth: 2,
            format: 'json',
        });
        const cmd = h.calls[0]![2] as Command;
        expect(cmd.getOptionValueSource('all')).toBe('cli');
        expect(cmd.getOptionValueSource('maxDepth')).toBe('cli');
    });

    it('collects repeatable options through the parser with the previous value', async () => {
        const h = harness();
        const { opts } = await h.parse(['-e', '*.log', '--exclude=tmp/', '-ebuild']);
        expect(opts['exclude']).toEqual(['*.log', 'tmp/', 'build']);
    });

    it('keeps the last value of a repeated single-value option', async () => {
        const h = harness();
        const { opts } = await h.parse(['--max-depth', '3', '--max-depth=5']);
        expect(opts['maxDepth']).toBe(5);
    });

    it('treats a bare optional-value flag as true and only takes non-option values', async () => {
        const h = harness();
        await h.parse(['-l', '-d']);
        expect(h.calls[0]![1]).toMatchObject({ largeFiles: true, duplicates: true });

        const sized = harness();
        await sized.parse(['-l', '50MB', 'dir']);
        expect(sized.calls[0]![0]).toBe('dir');
        expect(sized.calls[0]![1]).toMatchObject({ largeFiles: 'size:50MB' });
    });

    it('passes an empty --flag= value through the parser', async () => {
        const h = harness();
        const { opts } = await h.parse(['--large-files=', 'dir']);
        expect(opts['largeFiles']).toBe('size:');
        expect(h.calls[0]![0]).toBe('dir');
    });

    it('handles negatable options and their positive twins', async () => {
        const h = harness();
        const { opts } = await h.parse(['--no-color', '--no-progress']);
        expect(opts).toMatchObject({ color: false, progress: false });
        const cmd = h.calls[0]![2] as Command;
        expect(cmd.getOptionValueSource('color')).toBe('cli');
        expect(cmd.getOptionValueSource('progress')).toBe('cli');

        const positive = harness();
        await positive.parse(['--color']);
        expect(positive.calls[0]![1]).toMatchObject({ color: true });
    });

    it('stops option parsing at --', async () => {
        const h = harness();
        const { code } = await h.parse(['--', '-d']);
        expect(code).toBeUndefined();
        expect(h.calls[0]![0]).toBe('-d');
        expect(h.calls[0]![1]).not.toHaveProperty('duplicates');
    });

    it('dispatches to a named command and checks its arguments', async () => {
        const h = harness();
        await h.parse(['compare', 'a', 'b', '--content']);
        expect(h.calls[0]!.slice(0, 2)).toEqual(['a', 'b']);
        expect(h.calls[0]![2]).toMatchObject({ content: true });
    });
});

describe('Command errors', () => {
    it('rejects an unknown option with a suggestion and the help hint', async () => {
        const h = harness();
        const { code } = await h.parse(['--forma', 'json']);
        expect(code).toBe(1);
        expect(h.err()).toBe(
            "[red]error: unknown option '--forma'\n(Did you mean --format?)\n(see --help)\n"
        );
        expect(h.out()).toBe('');
        expect(h.calls).toHaveLength(0);
    });

    it('rejects an unknown option without a suggestion when nothing is close', async () => {
        const h = harness();
        await h.parse(['--zzzzzz']);
        expect(h.err()).toBe("[red]error: unknown option '--zzzzzz'\n(see --help)\n");
        const short = harness();
        await short.parse(['-z']);
        expect(short.err()).toContain("error: unknown option '-z'");
    });

    it('reports a missing option argument', async () => {
        const h = harness();
        const { code } = await h.parse(['--max-depth']);
        expect(code).toBe(1);
        expect(h.err()).toContain("error: option '--max-depth <n>' argument missing");
    });

    it('reports an invalid option argument with the parser message', async () => {
        const h = harness();
        await h.parse(['--max-depth', 'x']);
        expect(h.err()).toContain(
            "error: option '--max-depth <n>' argument 'x' is invalid. Expected a whole number."
        );
    });

    it('reports an invalid choice', async () => {
        const h = harness();
        await h.parse(['-f', 'xml']);
        expect(h.err()).toContain(
            "error: option '-f, --format <format>' argument 'xml' is invalid. Allowed choices are pretty, json."
        );
    });

    it('reports missing and excess positionals', async () => {
        const missing = harness();
        expect((await missing.parse(['compare', 'a'])).code).toBe(1);
        expect(missing.err()).toContain("error: missing required argument 'right'");

        const excess = harness();
        await excess.parse(['compare', 'a', 'b', 'c']);
        expect(excess.err()).toContain(
            "error: too many arguments for 'compare'. Expected 2 arguments but got 3: a, b, c."
        );

        const one = harness();
        await one.parse(['x', 'y']);
        expect(one.err()).toContain(
            "error: too many arguments for 'analyze'. Expected 1 argument but got 2: x, y."
        );
    });

    it('rethrows errors from a parser that are not InvalidArgumentError', async () => {
        const program = new Command('t').exitOverride();
        program.addOption(
            new Option('--boom <x>').argParser(() => {
                throw new TypeError('boom');
            })
        );
        await expect(program.parseAsync(['--boom', '1'], { from: 'user' })).rejects.toThrow(
            TypeError
        );
    });
});

describe('Command help and version', () => {
    it('prints the version and exits 0', async () => {
        const h = harness();
        const { code } = await h.parse(['--version']);
        expect(code).toBe(0);
        expect(h.out()).toBe('1.2.3\n');
        const short = harness();
        await short.parse(['-v']);
        expect(short.out()).toBe('1.2.3\n');
    });

    it('prints root help with commands and the trailing text', async () => {
        const h = harness();
        const { code } = await h.parse(['--help']);
        expect(code).toBe(0);
        const row = (term: string, description: string): string =>
            `  ${term.padEnd(32)}  ${description}`;
        expect(h.out()).toBe(
            [
                'Usage: dat [options] [command]',
                '',
                'A test program.',
                '',
                'Options:',
                row('-v, --version', 'print the version'),
                row('-h, --help', 'show help'),
                '',
                'Commands:',
                row('analyze [options] [directory]', 'analyze a directory'),
                row('compare [options] <left> <right>', 'compare two directories'),
                row('help [command]', 'show help for a command'),
                '',
                'Docs: https://example.test',
                '',
            ].join('\n')
        );
    });

    it('prints command help with argument defaults, option groups, choices, and examples', async () => {
        const h = harness();
        const { code } = await h.parse(['analyze', '-h']);
        expect(code).toBe(0);
        const text = h.out();
        expect(text).toContain('Usage: dat analyze [options] [directory]\n');
        // Terms are padded to the longest one, "-l, --large-files [size]".
        expect(text).toContain(
            `Arguments:\n  ${'directory'.padEnd(24)}  directory to analyze (default: ".")\n`
        );
        expect(text.indexOf('Scan options:')).toBeLessThan(text.indexOf('Report options:'));
        expect(text.indexOf('Report options:')).toBeLessThan(text.indexOf('Output options:'));
        expect(text.indexOf('Output options:')).toBeLessThan(
            text.indexOf('Options:\n  -h, --help')
        );
        expect(text).toContain('output format (choices: "pretty", "json")');
        expect(text).not.toContain('--secret');
        expect(text.endsWith('\nExamples:\n  $ dat .\n\n')).toBe(true);
    });

    it('wraps long descriptions to the help width', () => {
        const program = new Command('t').helpOption('-h, --help', 'show help');
        program.addOption(
            new Option(
                '--long-option-name <value>',
                'this description is long enough that it has to wrap onto a second line in eighty columns'
            )
        );
        const text = program.helpInformation(80);
        const lines = text.split('\n');
        expect(lines.every((line) => line.length <= 80)).toBe(true);
        expect(lines).toContain(
            '  --long-option-name <value>  this description is long enough that it has to'
        );
        expect(lines).toContain(`${' '.repeat(30)}wrap onto a second line in eighty columns`);
    });

    it('answers --help for the default command from the root, and help <command>', async () => {
        const root = harness();
        await root.parse(['.', '--help']);
        expect(root.out()).toContain('Usage: dat [options] [command]');

        const sub = harness();
        expect((await sub.parse(['help', 'compare'])).code).toBe(0);
        expect(sub.out()).toContain('Usage: dat compare [options] <left> <right>');

        const unknown = harness();
        expect((await unknown.parse(['help', 'nope'])).code).toBe(1);
        expect(unknown.err()).toContain('Usage: dat [options] [command]');
    });
});

describe('suggestSimilar', () => {
    it('suggests the closest long option within three edits', () => {
        const candidates = ['--format', '--json', '--all', '--color'];
        expect(suggestSimilar('--forma', candidates)).toBe('--format');
        expect(suggestSimilar('--jsn', candidates)).toBe('--json');
        expect(suggestSimilar('--totally-different', candidates)).toBe('');
    });
});
