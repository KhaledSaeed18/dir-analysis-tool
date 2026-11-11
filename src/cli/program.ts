import { Command, CommanderError } from './command.ts';
import { AbortError, DatError, errorMessage } from '../errors.ts';
import { escapeControlInLines } from '../format/text.ts';
import { VERSION } from '../version.ts';
import { normalizeArgv } from './argv.ts';
import { registerAnalyze } from './commands/analyze.ts';
import { registerCompare } from './commands/compare.ts';
import { registerExplain } from './commands/explain.ts';
import { registerInit } from './commands/init.ts';
import { registerWatch } from './commands/watch.ts';
import { Context } from './context.ts';
import { ExitCode, processIO, type CliIO } from './io.ts';

export function createProgram(ctx: Context): Command {
    const { io } = ctx;
    const program = new Command('dat')
        .description('Fast, zero-dependency directory analysis for your terminal and CI.')
        .version(VERSION, '-v, --version', 'print the version')
        .helpOption('-h, --help', 'show help')
        .helpCommand('help [command]', 'show help for a command')
        .configureOutput({
            writeOut: (text) => io.stdout.write(text),
            writeErr: (text) => io.stderr.write(text),
            outputError: (text, write) => write(ctx.err.red(escapeControlInLines(text))),
        })
        .showHelpAfterError('(run "dat --help" to see all options)')
        .showSuggestionAfterError(true)
        .exitOverride();

    registerAnalyze(program, ctx);
    registerCompare(program, ctx);
    registerExplain(program, ctx);
    registerWatch(program, ctx);
    registerInit(program, ctx);
    program.addHelpText(
        'after',
        `
Run "dat <command> --help" for the options of a command. Exit codes: 0 success,
1 error, 2 a budget failed, 130 interrupted.
Docs: https://github.com/KhaledSaeed18/dir-analysis-tool#readme`
    );
    return program;
}

/**
 * Runs the CLI and resolves with the process exit code. Never calls
 * `process.exit`, so pending output is always flushed.
 */
export async function run(argv: readonly string[], io: CliIO = processIO()): Promise<number> {
    const ctx = new Context(io);
    const program = createProgram(ctx);
    try {
        await program.parseAsync(normalizeArgv(argv, io.cwd), { from: 'user' });
        return ctx.exitCode;
    } catch (error) {
        return handleError(error, ctx);
    }
}

function handleError(error: unknown, ctx: Context): number {
    const { io, err } = ctx;
    if (error instanceof CommanderError) {
        // Help and version "errors" are normal exits; commander already printed usage errors.
        return error.exitCode === 0 ? ExitCode.Ok : ExitCode.Error;
    }
    if (error instanceof AbortError || (error instanceof Error && error.name === 'AbortError')) {
        io.stderr.write(`${err.yellow('interrupted')}\n`);
        return ExitCode.Interrupted;
    }
    if (error instanceof DatError) {
        io.stderr.write(`${err.red('error')} ${escapeControlInLines(error.message)}\n`);
        if (error.hint) io.stderr.write(`${err.dim(escapeControlInLines(error.hint))}\n`);
        return ExitCode.Error;
    }
    const message = escapeControlInLines(errorMessage(error));
    io.stderr.write(`${err.red('error')} ${message}\n`);
    if (io.env['DAT_DEBUG'] && error instanceof Error && error.stack) {
        io.stderr.write(`${err.dim(escapeControlInLines(error.stack))}\n`);
    } else {
        io.stderr.write(
            `${err.dim('Set DAT_DEBUG=1 for a stack trace. Please report unexpected errors: https://github.com/KhaledSaeed18/dir-analysis-tool/issues')}\n`
        );
    }
    return ExitCode.Error;
}
