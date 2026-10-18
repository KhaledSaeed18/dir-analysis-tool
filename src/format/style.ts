/**
 * Minimal ANSI styling with standard color detection.
 *
 * Detection order: `FORCE_COLOR` (0 disables, anything else enables), then
 * `NO_COLOR` (any non-empty value disables), then `TERM=dumb`, then whether
 * the stream is a TTY.
 */

export interface Style {
    readonly enabled: boolean;
    bold(text: string): string;
    dim(text: string): string;
    red(text: string): string;
    green(text: string): string;
    yellow(text: string): string;
    blue(text: string): string;
    magenta(text: string): string;
    cyan(text: string): string;
}

type Env = Record<string, string | undefined>;

export function supportsColor(
    stream: { isTTY?: boolean | undefined },
    env: Env = process.env
): boolean {
    const force = env['FORCE_COLOR'];
    if (force !== undefined) return force !== '0' && force !== 'false';
    if (env['NO_COLOR']) return false;
    if (env['TERM'] === 'dumb') return false;
    return stream.isTTY === true;
}

function wrap(enabled: boolean, open: number, close: number): (text: string) => string {
    if (!enabled) return (text) => text;
    return (text) => `\u001B[${open}m${text}\u001B[${close}m`;
}

export function createStyle(enabled: boolean): Style {
    return {
        enabled,
        bold: wrap(enabled, 1, 22),
        dim: wrap(enabled, 2, 22),
        red: wrap(enabled, 31, 39),
        green: wrap(enabled, 32, 39),
        yellow: wrap(enabled, 33, 39),
        blue: wrap(enabled, 34, 39),
        magenta: wrap(enabled, 35, 39),
        cyan: wrap(enabled, 36, 39),
    };
}

// oxlint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
    return text.replace(ANSI_PATTERN, '');
}
