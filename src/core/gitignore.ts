/**
 * A dependency-free gitignore matcher.
 *
 * Patterns follow `gitignore(5)`: blank lines and `#` comments are skipped,
 * `!` negates, a trailing `/` matches directories only, a pattern with a
 * slash (other than a trailing one) is anchored to the ignore file's
 * directory, `*` and `?` never cross a slash, `**` does, `[...]` is a
 * character class, and a backslash escapes the next character.
 *
 * Consecutive rules with the same sign are merged into one regular
 * expression, so a typical ignore file is tested with one or two regex
 * matches per path instead of one per rule. Later rules win, so the merged
 * runs are tried last to first.
 */

export interface GitignoreOptions {
    /** Case-insensitive matching. */
    ignoreCase?: boolean | undefined;
}

/** A run of consecutive rules that all ignore or all un-ignore. */
interface Run {
    negated: boolean;
    /** Literal names and `*suffix` rules, looked up without a regex. */
    anyFast: FastNames | null;
    dirFast: FastNames | null;
    /** Other unanchored rules without a slash: tested against the last path segment only. */
    anyName: RegExp | null;
    dirName: RegExp | null;
    /** Rules that need the whole path. */
    anyPath: RegExp | null;
    dirPath: RegExp | null;
}

/**
 * The compiled rules of one ignore file.
 *
 * `test()` returns `true` when the last matching rule ignores the path,
 * `false` when it un-ignores it, and `undefined` when no rule matches, so
 * several files can be chained with Git's precedence.
 */
export class GitignoreMatcher {
    readonly #runs: Run[];
    readonly #ignoreCase: boolean;

    private constructor(runs: Run[], ignoreCase: boolean) {
        this.#runs = runs;
        this.#ignoreCase = ignoreCase;
    }

    /** True when the file contains at least one rule. */
    get hasRules(): boolean {
        return this.#runs.length > 0;
    }

    /**
     * @param path Path relative to the ignore file's directory, `/`-separated,
     *   without leading or trailing slashes.
     */
    test(path: string, isDirectory: boolean): boolean | undefined {
        const runs = this.#runs;
        let name: string | undefined;
        let folded: string | undefined;
        for (let i = runs.length - 1; i >= 0; i--) {
            const run = runs[i]!;
            const fast = isDirectory && run.dirFast !== null ? true : run.anyFast !== null;
            const byName = run.anyName !== null || (isDirectory && run.dirName !== null);
            if (fast || byName) {
                name ??= path.slice(path.lastIndexOf('/') + 1);
                if (fast) {
                    folded ??= this.#ignoreCase ? name.toLowerCase() : name;
                    if (run.anyFast?.has(folded) || (isDirectory && run.dirFast?.has(folded))) {
                        return !run.negated;
                    }
                }
                if (run.anyName?.test(name) || (isDirectory && run.dirName?.test(name))) {
                    return !run.negated;
                }
            }
            if (run.anyPath?.test(path) || (isDirectory && run.dirPath?.test(path))) {
                return !run.negated;
            }
        }
        return undefined;
    }

    /** Compiles the contents of an ignore file (or a list of patterns). */
    static compile(
        source: string | readonly string[],
        options: GitignoreOptions = {}
    ): GitignoreMatcher {
        const lines = typeof source === 'string' ? source.split(/\r?\n/) : source;
        const ignoreCase = options.ignoreCase === true;
        const flags = ignoreCase ? 'i' : '';
        const runs: Run[] = [];
        let negated = false;
        let parts = new RunParts();
        const regex = (sources: string[]): RegExp | null =>
            sources.length > 0 ? new RegExp(`^(?:${sources.join('|')})$`, flags) : null;
        const flush = (): void => {
            const run: Run = {
                negated,
                anyFast: parts.anyFast.isEmpty ? null : parts.anyFast,
                dirFast: parts.dirFast.isEmpty ? null : parts.dirFast,
                anyName: regex(parts.anyName),
                dirName: regex(parts.dirName),
                anyPath: regex(parts.anyPath),
                dirPath: regex(parts.dirPath),
            };
            if (
                run.anyFast ||
                run.dirFast ||
                run.anyName ||
                run.dirName ||
                run.anyPath ||
                run.dirPath
            ) {
                runs.push(run);
            }
            parts = new RunParts();
        };

        for (const line of lines) {
            const rule = parseRule(line);
            if (rule === null) continue;
            if (rule.negated !== negated) {
                flush();
                negated = rule.negated;
            }
            if (rule.fast) {
                const target = rule.dirOnly ? parts.dirFast : parts.anyFast;
                const value = ignoreCase ? rule.fast.value.toLowerCase() : rule.fast.value;
                if (rule.fast.kind === 'literal') target.literals.add(value);
                else target.addSuffix(value);
            } else if (rule.nameOnly) {
                (rule.dirOnly ? parts.dirName : parts.anyName).push(rule.source);
            } else {
                (rule.dirOnly ? parts.dirPath : parts.anyPath).push(rule.source);
            }
        }
        flush();
        return new GitignoreMatcher(runs, ignoreCase);
    }
}

/** Exact names and `*suffix` rules of one run, matched with hash lookups. */
class FastNames {
    readonly literals = new Set<string>();
    /** Suffixes keyed by their last character, so a name checks only a few. */
    readonly #suffixes = new Map<string, string[]>();

    get isEmpty(): boolean {
        return this.literals.size === 0 && this.#suffixes.size === 0;
    }

    addSuffix(suffix: string): void {
        const key = suffix[suffix.length - 1]!;
        const list = this.#suffixes.get(key);
        if (list) list.push(suffix);
        else this.#suffixes.set(key, [suffix]);
    }

    has(name: string): boolean {
        if (this.literals.has(name)) return true;
        if (name === '') return false;
        const list = this.#suffixes.get(name[name.length - 1]!);
        if (list === undefined) return false;
        for (const suffix of list) if (name.endsWith(suffix)) return true;
        return false;
    }
}

class RunParts {
    readonly anyFast = new FastNames();
    readonly dirFast = new FastNames();
    readonly anyName: string[] = [];
    readonly dirName: string[] = [];
    readonly anyPath: string[] = [];
    readonly dirPath: string[] = [];
}

interface Rule {
    negated: boolean;
    dirOnly: boolean;
    /** The rule can only match a single path segment, so it is tested against the name alone. */
    nameOnly: boolean;
    /** A name-only rule simple enough to skip regular expressions. */
    fast: { kind: 'literal' | 'suffix'; value: string } | null;
    /** Regular expression source matching the whole relative path (or the name, when `nameOnly`). */
    source: string;
}

/** No wildcards, classes, or escapes: the pattern is a literal name (or suffix). */
const LITERAL = /^[^*?[\\]+$/;

/** Turns one gitignore line into a regex fragment; `null` for blanks and comments. */
export function parseRule(line: string): Rule | null {
    // Trailing spaces are ignored unless escaped with a backslash.
    let pattern = line.replace(/(?<!\\)\s+$/, '');
    if (pattern === '' || pattern.startsWith('#')) return null;

    let negated = false;
    if (pattern.startsWith('!')) {
        negated = true;
        pattern = pattern.slice(1);
    } else if (pattern.startsWith('\\!') || pattern.startsWith('\\#')) {
        pattern = pattern.slice(1);
    }
    if (pattern === '') return null;

    let dirOnly = false;
    if (pattern.endsWith('/') && !pattern.endsWith('\\/')) {
        dirOnly = true;
        pattern = pattern.replace(/\/+$/, '');
        if (pattern === '') return null;
    }

    // A slash anywhere but the end anchors the pattern to the ignore file's directory.
    let anchored = false;
    if (pattern.startsWith('/')) {
        anchored = true;
        pattern = pattern.replace(/^\/+/, '');
    } else if (pattern.includes('/')) {
        anchored = true;
    }
    if (pattern.startsWith('**/')) {
        // "**/foo" matches at any depth, which is what unanchored already means.
        anchored = false;
        pattern = pattern.replace(/^(\*\*\/)+/, '');
    }
    // Nothing left to match after stripping path prefixes.
    if (pattern === '') return null;

    const body = globToRegex(pattern);
    if (body === null) return null;
    // Without a slash, "*" and "?" cannot cross segments, so only the name matters.
    const nameOnly = !anchored && !pattern.includes('/') && !pattern.includes('**');
    const source = anchored || nameOnly ? body : `(?:.*/)?${body}`;
    let fast: Rule['fast'] = null;
    if (nameOnly) {
        if (LITERAL.test(pattern)) fast = { kind: 'literal', value: pattern };
        else if (pattern.startsWith('*') && LITERAL.test(pattern.slice(1))) {
            fast = { kind: 'suffix', value: pattern.slice(1) };
        }
    }
    return { negated, dirOnly, nameOnly, fast, source };
}

/**
 * Translates a gitignore glob (already stripped of anchors and trailing
 * slashes) into regex source. Returns `null` for an unusable pattern.
 */
function globToRegex(glob: string): string | null {
    let out = '';
    const n = glob.length;
    for (let i = 0; i < n; i++) {
        const c = glob[i]!;
        if (c === '\\') {
            if (i + 1 < n) out += escapeRegex(glob[++i]!);
            else out += '\\\\';
        } else if (c === '*') {
            if (glob[i + 1] === '*') {
                // Collapse any run of stars.
                let j = i + 1;
                while (glob[j] === '*') j++;
                const atStart = i === 0 || glob[i - 1] === '/';
                const atEnd = j === n;
                if (atStart && atEnd) {
                    // "a/**" matches everything inside a.
                    out += '.*';
                } else if (atStart && glob[j] === '/') {
                    // "a/**/b" matches zero or more directories.
                    out += '(?:.*/)?';
                    j++;
                } else {
                    // Other consecutive stars are ordinary stars.
                    out += '[^/]*';
                }
                i = j - 1;
            } else {
                out += '[^/]*';
            }
        } else if (c === '?') {
            out += '[^/]';
        } else if (c === '[') {
            const cls = parseClass(glob, i);
            if (cls === null) {
                out += '\\[';
            } else {
                out += cls.source;
                i = cls.end;
            }
        } else if (c === '/') {
            out += '/';
        } else {
            out += escapeRegex(c);
        }
    }
    return out;
}

/** Parses a bracket expression starting at `start`; `null` when it is not closed. */
function parseClass(glob: string, start: number): { source: string; end: number } | null {
    let i = start + 1;
    let negate = false;
    if (glob[i] === '!' || glob[i] === '^') {
        negate = true;
        i++;
    }
    let body = '';
    let first = true;
    for (; i < glob.length; i++) {
        const c = glob[i]!;
        if (c === ']' && !first) {
            // Git never lets a class match a slash.
            const source = negate ? `(?!/)[^${body}]` : `[${body}]`;
            return { source, end: i };
        }
        first = false;
        if (c === '\\' && i + 1 < glob.length) {
            body += `\\${glob[++i]!}`;
        } else if (c === '[' && glob[i + 1] === ':') {
            const close = glob.indexOf(':]', i + 2);
            if (close === -1) return null;
            const name = glob.slice(i + 2, close);
            const posix = POSIX_CLASSES[name];
            if (posix === undefined) return null;
            body += posix;
            i = close + 1;
        } else if (c === '/') {
            return null;
        } else if (c === '-' || c === ']' || c === '^') {
            body += c === ']' ? '\\]' : c === '^' ? '\\^' : '-';
        } else {
            body += escapeInClass(c);
        }
    }
    return null;
}

const POSIX_CLASSES: Record<string, string> = {
    alnum: 'a-zA-Z0-9',
    alpha: 'a-zA-Z',
    blank: ' \\t',
    cntrl: '\\x00-\\x1f\\x7f',
    digit: '0-9',
    graph: '\\x21-\\x7e',
    lower: 'a-z',
    print: '\\x20-\\x7e',
    punct: '!-\\/:-@\\[-`{-~',
    space: ' \\t\\r\\n\\v\\f',
    upper: 'A-Z',
    xdigit: '0-9A-Fa-f',
};

function escapeRegex(c: string): string {
    return /[\\^$.*+?()[\]{}|/-]/.test(c) ? `\\${c}` : c;
}

function escapeInClass(c: string): string {
    return c === '\\' ? '\\\\' : c;
}
