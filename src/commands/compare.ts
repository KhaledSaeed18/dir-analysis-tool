import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { analyze } from '../core/analyzer.js';
import { printComparison } from '../reporters/console.js';

export const compareCommand = new Command('compare')
    .description('Compare two directories side by side')
    .argument('<dir1>', 'First directory')
    .argument('<dir2>', 'Second directory')
    .option('--no-recursive', 'Disable recursive analysis')
    .option('-e, --exclude <patterns...>', 'Exclude patterns')
    .option('--max-depth <depth>', 'Maximum directory depth', parseInt)
    .option('-j, --json', 'Output comparison as JSON')
    .action(async (dir1, dir2, options) => {
        try {
            const path1 = resolve(dir1);
            const path2 = resolve(dir2);

            const sharedOpts = {
                recursive: options.recursive !== false,
                excludePatterns: options.exclude ?? [],
                maxDepth: options.maxDepth as number | undefined,
            };

            console.log(chalk.blue('Analyzing directories…'));
            const [result1, result2] = await Promise.all([
                analyze({ path: path1, ...sharedOpts }),
                analyze({ path: path2, ...sharedOpts }),
            ]);

            if (options.json) {
                console.log(JSON.stringify({ dir1: result1, dir2: result2 }, null, 2));
            } else {
                printComparison(result1, result2);
            }
        } catch (err) {
            console.error(chalk.red('Error:', err instanceof Error ? err.message : String(err)));
            process.exit(1);
        }
    });
