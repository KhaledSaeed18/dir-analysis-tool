const BAR_LENGTH = 40;
const UPDATE_INTERVAL_MS = 100;

export class ProgressBar {
    private lastUpdate = 0;

    static isTTY(): boolean {
        return process.stdout.isTTY === true;
    }

    show(current: number, total: number, label?: string): void {
        if (!ProgressBar.isTTY()) return;

        const now = Date.now();
        if (now - this.lastUpdate < UPDATE_INTERVAL_MS && current !== total) return;
        this.lastUpdate = now;

        const pct = Math.min(100, Math.round((current / total) * 100));
        const filled = Math.round((current / total) * BAR_LENGTH);
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_LENGTH - filled);
        const progressText = `[${bar}] ${pct}% (${current}/${total})`;

        let output = `\r${progressText}`;
        if (label) {
            const cols = process.stdout.columns ?? 80;
            const maxLen = cols - progressText.length - 2;
            const display = label.length > maxLen ? '...' + label.slice(-(maxLen - 3)) : label;
            output += ` ${display}`;
        }

        process.stdout.write(output);
        if (current === total) process.stdout.write('\n');
    }

    static createHashCallback(
        bar: ProgressBar
    ): (done: number, total: number) => void {
        return (done, total) => bar.show(done, total, 'hashing files');
    }
}

export class ScanCounter {
    private count = 0;
    private timer: ReturnType<typeof setInterval> | null = null;

    start(label: string): void {
        if (!ProgressBar.isTTY()) return;
        this.timer = setInterval(() => {
            process.stdout.write(`\r${label}: ${this.count.toLocaleString()} files scanned...`);
        }, 150);
    }

    increment(): void {
        this.count++;
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (ProgressBar.isTTY()) process.stdout.write('\r\x1b[K');
    }
}
