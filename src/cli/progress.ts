import type { AnalysisProgress } from '../core/analyze.ts';
import { formatBytes, type ByteUnits } from '../format/bytes.ts';
import type { Style } from '../format/style.ts';
import { formatCount } from '../format/text.ts';
import type { OutputStream } from './io.ts';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const CLEAR_LINE = '\r\u001B[2K';

/** A single, self-overwriting status line on stderr. A no-op unless enabled. */
export class ProgressLine {
    readonly #stream: OutputStream;
    readonly #enabled: boolean;
    readonly #style: Style;
    readonly #units: ByteUnits;
    #frame = 0;
    #visible = false;

    constructor(stream: OutputStream, enabled: boolean, style: Style, units: ByteUnits) {
        this.#stream = stream;
        this.#enabled = enabled;
        this.#style = style;
        this.#units = units;
    }

    get enabled(): boolean {
        return this.#enabled;
    }

    update(text: string): void {
        if (!this.#enabled) return;
        const frame = FRAMES[this.#frame++ % FRAMES.length]!;
        const width = (this.#stream.columns ?? 80) - 1;
        const line = `${frame} ${text}`;
        this.#stream.write(
            `${CLEAR_LINE}${this.#style.cyan(line.length > width ? `${line.slice(0, width - 1)}…` : line)}`
        );
        this.#visible = true;
    }

    analysis(progress: AnalysisProgress): void {
        if (progress.phase === 'scan') {
            this.update(
                `Scanning · ${formatCount(progress.files)} files · ${formatCount(progress.directories)} folders · ${formatBytes(progress.bytes, this.#units)}`
            );
        } else {
            const label = progress.stage === 'sample' ? 'Comparing samples' : 'Hashing';
            this.update(
                `${label} · ${formatCount(progress.done)} of ${formatCount(progress.total)} candidate files`
            );
        }
    }

    clear(): void {
        if (this.#visible) this.#stream.write(CLEAR_LINE);
        this.#visible = false;
    }
}
