import { Command } from 'commander';
import { analyzeCommand } from './commands/analyze.js';
import { watchCommand } from './commands/watch.js';
import { initCommand } from './commands/init.js';
import { compareCommand } from './commands/compare.js';

declare const __VERSION__: string;

const program = new Command();

program
    .name('dat')
    .description('Directory Analysis Tool — fast, memory-safe directory analysis for your terminal')
    .version(typeof __VERSION__ !== 'undefined' ? __VERSION__ : '2.0.0', '-v, --version');

program.addCommand(analyzeCommand, { isDefault: true });
program.addCommand(watchCommand);
program.addCommand(initCommand);
program.addCommand(compareCommand);

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(1);
});

program.parse();
