import { ProgressCallback } from './types';

export class ProgressBar {
    private static readonly BAR_LENGTH = 40;
    private lastUpdateTime = 0;
    private readonly updateInterval = 100; // Update every 100ms

    show(current: number, total: number, currentPath?: string): void {
        const now = Date.now();
        if (now - this.lastUpdateTime < this.updateInterval && current !== total) {
            return;
        }
        this.lastUpdateTime = now;

        const percentage = Math.min(100, Math.round((current / total) * 100));
        const filled = Math.round((current / total) * ProgressBar.BAR_LENGTH);
        const empty = ProgressBar.BAR_LENGTH - filled;

        const bar = '█'.repeat(filled) + '░'.repeat(empty);
        const progressText = `[${bar}] ${percentage}% (${current}/${total})`;

        let output = `\r${progressText}`;

        if (currentPath) {
            const maxPathLength = process.stdout.columns ? process.stdout.columns - progressText.length - 5 : 50;
            const displayPath = currentPath.length > maxPathLength
                ? '...' + currentPath.slice(-(maxPathLength - 3))
                : currentPath;
            output += ` ${displayPath}`;
        }

        process.stdout.write(output);

        if (current === total) {
            process.stdout.write('\n');
        }
    }

    static createCallback(enabled: boolean = true): ProgressCallback | undefined {
        if (!enabled) return undefined;

        const progressBar = new ProgressBar();
        return (current: number, total: number, currentPath?: string) => {
            progressBar.show(current, total, currentPath);
        };
    }
}
