import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Option, type Command } from '../command.ts';
import { parseBudget } from '../../core/budgets.ts';
import { DatError, errorMessage } from '../../errors.ts';
import { parseSize } from '../../format/bytes.ts';
import type { DatConfig } from '../../config/schema.ts';
import type { Context } from '../context.ts';
import { CANCEL, Prompter, type Cancel } from '../prompt.ts';

export const SCHEMA_URL = 'https://unpkg.com/dir-analysis-tool@3/schema.json';

export function registerInit(program: Command, ctx: Context): void {
    program
        .command('init')
        .description('create a .dir-analyzer.json config file')
        .argument('[directory]', 'where to create the file', '.')
        .addOption(new Option('-y, --yes', 'skip the questions and write a starter config'))
        .addOption(new Option('--force', 'overwrite an existing config file'))
        .action(async (directory: string, options: { yes?: boolean; force?: boolean }) => {
            const path = join(ctx.resolvePath(directory), '.dir-analyzer.json');
            const exists = existsSync(path);
            if (exists && !options.force && (options.yes || !ctx.io.stdinIsTTY)) {
                throw new DatError(`${path} already exists.`, {
                    hint: 'Use --force to overwrite it.',
                });
            }

            let config: DatConfig | null;
            if (options.yes) {
                config = { exclude: [], gitignore: false, top: 10 };
            } else {
                if (!ctx.io.stdinIsTTY) {
                    throw new DatError(
                        'dat init asks questions, but this is not an interactive terminal.',
                        {
                            hint: 'Use "dat init --yes" to write a starter config.',
                        }
                    );
                }
                config = await ask(ctx, exists && !options.force);
            }
            if (!config) return;

            const file = await ctx.writeFile(
                path,
                `${JSON.stringify({ $schema: SCHEMA_URL, ...config }, null, 4)}\n`
            );
            ctx.info(`${ctx.err.green('✔')} Wrote ${file}`, false);
        });
}

/** Interactive questions, asked on the CLI's own stdin/stdout. */
async function ask(ctx: Context, confirmOverwrite: boolean): Promise<DatConfig | null> {
    const p = new Prompter(ctx.io);
    function bail<T extends string | boolean>(value: T | Cancel): T {
        if (value === CANCEL) {
            p.cancel('Cancelled. Nothing was written.');
            throw new CancelledError();
        }
        return value;
    }

    try {
        p.intro('dat init');
        if (confirmOverwrite) {
            const overwrite = bail(
                await p.confirm({
                    message: '.dir-analyzer.json already exists. Overwrite it?',
                    initialValue: false,
                })
            );
            if (!overwrite) {
                p.cancel('Kept the existing file.');
                return null;
            }
        }

        const exclude = bail(
            await p.text({
                message: 'Patterns to exclude (comma-separated, gitignore syntax)',
                placeholder: 'coverage/, *.log, tmp/',
            })
        );
        const gitignore = bail(
            await p.confirm({ message: 'Honor .gitignore files?', initialValue: true })
        );
        const large = bail(
            await p.text({
                message: 'Report files at least this large (leave empty to skip)',
                placeholder: '100MiB',
                validate: (value) => validateWith(value, parseSize),
            })
        );
        const duplicates = bail(
            await p.confirm({
                message: 'Look for duplicate files on every run?',
                initialValue: false,
            })
        );
        const top = bail(
            await p.text({
                message: 'How many of the largest files and folders to list',
                placeholder: '10',
                defaultValue: '10',
                validate: (value) =>
                    !value || /^\d+$/.test(value.trim())
                        ? undefined
                        : 'Enter a whole number, such as 10.',
            })
        );
        const budgets = bail(
            await p.text({
                message: 'Budgets that must hold (comma-separated, leave empty for none)',
                placeholder: 'size<=500MB, duplicates=0',
                validate: (value) => {
                    for (const rule of splitList(value)) {
                        const problem = validateWith(rule, parseBudget);
                        if (problem) return problem;
                    }
                    return undefined;
                },
            })
        );

        const config: DatConfig = {};
        const patterns = splitList(exclude);
        if (patterns.length > 0) config.exclude = patterns;
        config.gitignore = gitignore;
        if (large.trim()) config.largeFiles = large.trim();
        if (duplicates) config.duplicates = true;
        config.top = Number(top.trim() || '10');
        const rules = splitList(budgets);
        if (rules.length > 0) config.budgets = rules;
        p.outro('Done. Run "dat" to analyze with these settings.');
        return config;
    } catch (error) {
        if (error instanceof CancelledError) return null;
        throw error;
    } finally {
        p.close();
    }
}

class CancelledError extends Error {}

function splitList(value: string): string[] {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function validateWith(
    value: string | undefined,
    parse: (v: string) => unknown
): string | undefined {
    if (!value || !value.trim()) return undefined;
    try {
        parse(value.trim());
        return undefined;
    } catch (error) {
        return errorMessage(error);
    }
}
