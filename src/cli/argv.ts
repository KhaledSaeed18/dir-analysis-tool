import { parseSize } from '../format/bytes.ts';
import { parsePointInTime } from '../format/time.ts';

/**
 * Options whose value is optional. Commander would treat the next argument
 * as their value, so `dat -l ./photos` would read "./photos" as a size. For
 * these flags the next argument is only taken when it is a valid value;
 * otherwise the flag is used with its default and the argument stays
 * positional.
 */
const OPTIONAL_VALUE_FLAGS: ReadonlyArray<{
    names: readonly string[];
    long: string;
    accepts: (value: string) => boolean;
}> = [
    { names: ['-l', '--large-files'], long: '--large-files', accepts: isSize },
    { names: ['--stale'], long: '--stale', accepts: isPointInTime },
    { names: ['--html'], long: '--html', accepts: (v) => /\.html?$/i.test(v) },
    { names: ['--csv'], long: '--csv', accepts: (v) => /\.csv$/i.test(v) },
];

export function normalizeArgv(argv: readonly string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i]!;
        if (token === '--') {
            out.push(...argv.slice(i));
            break;
        }
        const flag = OPTIONAL_VALUE_FLAGS.find((f) => f.names.includes(token));
        const next = argv[i + 1];
        if (flag && next !== undefined && !next.startsWith('-') && !flag.accepts(next)) {
            out.push(`${flag.long}=`);
            continue;
        }
        out.push(token);
    }
    return out;
}

function isSize(value: string): boolean {
    try {
        parseSize(value);
        return true;
    } catch {
        return false;
    }
}

function isPointInTime(value: string): boolean {
    try {
        parsePointInTime(value);
        return true;
    } catch {
        return false;
    }
}
