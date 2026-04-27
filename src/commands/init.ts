import { Command } from 'commander';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { intro, outro, text, confirm, isCancel, cancel } from '@clack/prompts';
import chalk from 'chalk';
import type { Config } from '../types.js';

export const initCommand = new Command('init')
    .description('Create a .dir-analyzer.json configuration file interactively')
    .option('--cwd <path>', 'Directory to create the config in (default: current directory)')
    .action(async (options) => {
        const cwd = options.cwd ?? process.cwd();
        const configPath = join(cwd, '.dir-analyzer.json');

        if (existsSync(configPath)) {
            const overwrite = await confirm({
                message: `.dir-analyzer.json already exists. Overwrite?`,
                initialValue: false,
            });
            if (isCancel(overwrite) || !overwrite) {
                cancel('Aborted.');
                process.exit(0);
            }
        }

        intro(chalk.blue('dat init — Create .dir-analyzer.json'));

        const excludeRaw = await text({
            message: 'Extra directories/patterns to exclude (comma-separated, or leave empty)',
            placeholder: 'coverage,tmp,__pycache__',
            defaultValue: '',
        });
        if (isCancel(excludeRaw)) { cancel('Cancelled.'); process.exit(0); }

        const clearDefaults = await confirm({
            message: 'Clear default exclusions? (node_modules, .git, dist, build, .cache)',
            initialValue: false,
        });
        if (isCancel(clearDefaults)) { cancel('Cancelled.'); process.exit(0); }

        const largeFilesRaw = await text({
            message: 'Large-file threshold in MB (leave empty to disable)',
            placeholder: '100',
            defaultValue: '',
            validate: (v) => {
                if (!v || v.trim() === '') return;
                if (isNaN(parseFloat(v)) || parseFloat(v) <= 0) return 'Must be a positive number';
            },
        });
        if (isCancel(largeFilesRaw)) { cancel('Cancelled.'); process.exit(0); }

        const enableDuplicates = await confirm({
            message: 'Enable duplicate detection by default?',
            initialValue: false,
        });
        if (isCancel(enableDuplicates)) { cancel('Cancelled.'); process.exit(0); }

        const maxDepthRaw = await text({
            message: 'Maximum directory depth (-1 for unlimited)',
            defaultValue: '-1',
            validate: (v) => {
                if (!v) return;
                if (isNaN(parseInt(v))) return 'Must be an integer';
            },
        });
        if (isCancel(maxDepthRaw)) { cancel('Cancelled.'); process.exit(0); }

        const topNRaw = await text({
            message: 'Default number of top largest files to show (0 to disable)',
            defaultValue: '10',
            validate: (v) => {
                if (!v) return;
                if (isNaN(parseInt(v)) || parseInt(v) < 0) return 'Must be a non-negative integer';
            },
        });
        if (isCancel(topNRaw)) { cancel('Cancelled.'); process.exit(0); }

        const config: Config = {};

        const excludeList = String(excludeRaw)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (excludeList.length > 0) config.excludePatterns = excludeList;
        if (clearDefaults) config.clearDefaultExclusions = true;
        if (String(largeFilesRaw).trim() !== '') config.largeSizeThresholdMB = parseFloat(String(largeFilesRaw));
        if (enableDuplicates) config.enableDuplicateDetection = true;

        const depth = parseInt(String(maxDepthRaw));
        if (!isNaN(depth) && depth !== -1) config.maxDepth = depth;

        const topN = parseInt(String(topNRaw));
        if (!isNaN(topN) && topN > 0) config.topN = topN;

        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

        outro(chalk.green(`✅ Config saved to ${configPath}`));
    });
