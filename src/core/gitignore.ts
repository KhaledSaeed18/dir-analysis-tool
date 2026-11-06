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
 *
 * A regular expression with several wildcards can backtrack for a very long
 * time on a long name, and an ignore file may come from an untrusted repository.
 * Rules with two or more wildcards therefore run on {@link LinearGlob}, whose
 * time grows linearly with the length of the path.
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
    /** Rules with several wildcards, which are not safe to give to a regular expression. */
    globs: LinearGlob[] | null;
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
        let foldedPath: string | undefined;
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
            if (run.globs !== null) {
                name ??= path.slice(path.lastIndexOf('/') + 1);
                for (const glob of run.globs) {
                    if (glob.dirOnly && !isDirectory) continue;
                    // Most rules are ruled out here, without running the matcher at all.
                    if (this.#ignoreCase) {
                        const lower = glob.nameOnly
                            ? (folded ??= name.toLowerCase())
                            : (foldedPath ??= path.toLowerCase());
                        if (!lower.includes(glob.required)) continue;
                    } else if (!(glob.nameOnly ? name : path).includes(glob.required)) {
                        continue;
                    }
                    if (glob.matches(glob.nameOnly ? name : path)) return !run.negated;
                }
            }
        }
        return undefined;
    }

    /** Compiles the contents of an ignore file (or a list of patterns). */
    static compile(
        source: string | readonly string[],
        options: GitignoreOptions = {}
    ): GitignoreMatcher {
        // Like Git, skip a leading byte order mark and strip one CR from each line ending.
        const lines =
            typeof source === 'string' ? source.replace(/^\uFEFF/, '').split(EOL) : source;
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
                globs: parts.globs.length > 0 ? parts.globs : null,
            };
            if (
                run.anyFast ||
                run.dirFast ||
                run.anyName ||
                run.dirName ||
                run.anyPath ||
                run.dirPath ||
                run.globs
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
            } else if (rule.wildcards >= LINEAR_GLOB_WILDCARDS) {
                parts.globs.push(new LinearGlob(rule, ignoreCase));
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
    readonly globs: LinearGlob[] = [];
}

/** One step of a parsed glob. */
type Token =
    | { kind: 'char'; char: string }
    | { kind: 'class'; source: string }
    /** `?`: one character other than a slash. */
    | { kind: 'any' }
    /** `*`: any characters other than a slash. */
    | { kind: 'star' }
    /** A trailing `**`: anything at all. */
    | { kind: 'all' }
    /** `**` followed by a slash: nothing, or anything that ends in a slash. */
    | { kind: 'dirs' };

const STAR: Token = { kind: 'star' };
const ALL: Token = { kind: 'all' };
const DIRS: Token = { kind: 'dirs' };
const ANY: Token = { kind: 'any' };

/** Rules with at least this many wildcards use {@link LinearGlob}. */
const LINEAR_GLOB_WILDCARDS = 2;

function isWildcard(token: Token): boolean {
    return token.kind === 'star' || token.kind === 'all' || token.kind === 'dirs';
}

/** JavaScript's `.` skips line breaks, so these use `[^]`, which matches any character. */
function tokenSource(token: Token): string {
    switch (token.kind) {
        case 'char':
            return escapeRegex(token.char);
        case 'class':
            return token.source;
        case 'any':
            return '[^/]';
        case 'star':
            return '[^/]*';
        case 'all':
            return '[^]*';
        case 'dirs':
            return '(?:[^]*/)?';
    }
}

const CHAR = 0;
const CLASS = 1;
const ANY_CHAR = 2;
const ANY_RUN = 3;
const ALL_RUN = 4;
const DIRS_RUN = 5;
const OPCODES = {
    char: CHAR,
    class: CLASS,
    any: ANY_CHAR,
    star: ANY_RUN,
    all: ALL_RUN,
    dirs: DIRS_RUN,
};

/** The same case folding as a regular expression with the `i` flag. */
function foldCase(c: string): string {
    const upper = c.toUpperCase();
    if (upper.length !== 1) return c;
    return c.charCodeAt(0) >= 128 && upper.charCodeAt(0) < 128 ? c : upper;
}

/** The longest stretch of plain ASCII characters that a glob must match literally. */
function longestAsciiRun(tokens: readonly Token[]): string {
    let longest = '';
    let run = '';
    for (const token of tokens) {
        if (token.kind === 'char' && token.char.charCodeAt(0) < 128) {
            run += token.char;
            if (run.length > longest.length) longest = run;
        } else {
            run = '';
        }
    }
    return longest;
}

/**
 * Matches a parsed glob by tracking every position it could be at, one input
 * character at a time. Nothing is ever retried, so the time is bounded by the
 * length of the path times the length of the pattern, whatever the pattern is.
 */
export class LinearGlob {
    readonly dirOnly: boolean;
    readonly nameOnly: boolean;
    /**
     * Text every match must contain, in lower case when ignoring case. Only ASCII
     * is used: a regular expression's `i` flag never folds other characters into
     * ASCII, so lower-casing a path cannot hide or invent an occurrence of it.
     */
    readonly required: string;
    readonly #ops: Uint8Array;
    readonly #chars: string[];
    readonly #classes: Array<RegExp | null>;
    readonly #accept: number;
    readonly #ignoreCase: boolean;
    #current: Int32Array;
    #next: Int32Array;
    #nextCount = 0;
    /** The step at which each position was last added, so it is added only once per step. */
    readonly #added: Float64Array;
    /** The same for following a wildcard to the position after it. */
    readonly #skipped: Float64Array;
    #step = 0;

    constructor(rule: Pick<Rule, 'dirOnly' | 'nameOnly' | 'tokens'>, ignoreCase: boolean) {
        const { tokens } = rule;
        this.dirOnly = rule.dirOnly;
        this.nameOnly = rule.nameOnly;
        this.#ignoreCase = ignoreCase;
        const required = longestAsciiRun(tokens);
        this.required = ignoreCase ? required.toLowerCase() : required;
        const size = tokens.length + 1;
        this.#accept = tokens.length;
        this.#ops = Uint8Array.from(tokens, (token) => OPCODES[token.kind]);
        this.#chars = tokens.map((token) => {
            if (token.kind !== 'char') return '';
            return ignoreCase ? foldCase(token.char) : token.char;
        });
        this.#classes = tokens.map((token) =>
            token.kind === 'class' ? new RegExp(`^${token.source}$`, ignoreCase ? 'i' : '') : null
        );
        this.#current = new Int32Array(size);
        this.#next = new Int32Array(size);
        this.#added = new Float64Array(size);
        this.#skipped = new Float64Array(size);
    }

    matches(text: string): boolean {
        const ops = this.#ops;
        const chars = this.#chars;
        const accept = this.#accept;
        this.#nextCount = 0;
        this.#step++;
        this.#add(0, true);
        for (let i = 0; i < text.length; i++) {
            const count = this.#nextCount;
            if (count === 0) return false;
            const current = this.#next;
            this.#next = this.#current;
            this.#current = current;
            this.#nextCount = 0;
            this.#step++;
            const c = text[i]!;
            const folded = this.#ignoreCase ? foldCase(c) : c;
            for (let k = 0; k < count; k++) {
                const position = current[k]!;
                if (position === accept) continue;
                switch (ops[position]!) {
                    case CHAR:
                        if (folded === chars[position]) this.#add(position + 1, true);
                        break;
                    case CLASS:
                        if (this.#classes[position]!.test(c)) this.#add(position + 1, true);
                        break;
                    case ANY_CHAR:
                        if (c !== '/') this.#add(position + 1, true);
                        break;
                    case ANY_RUN:
                        if (c !== '/') this.#add(position, true);
                        break;
                    case ALL_RUN:
                        this.#add(position, true);
                        break;
                    default:
                        // Inside "**/", the next step is only reachable right after a slash.
                        this.#add(position, false);
                        if (c === '/') this.#add(position + 1, true);
                }
            }
        }
        return this.#added[accept] === this.#step;
    }

    #add(position: number, arriving: boolean): void {
        const step = this.#step;
        for (let at = position; ; at++) {
            if (this.#added[at] !== step) {
                this.#added[at] = step;
                this.#next[this.#nextCount++] = at;
            }
            // A wildcard can match nothing, so arriving at one also arrives at what follows it.
            if (!arriving || at === this.#accept || this.#ops[at]! < ANY_RUN) return;
            if (this.#skipped[at] === step) return;
            this.#skipped[at] = step;
        }
    }
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
    /** The parsed pattern that `source` was generated from. */
    tokens: Token[];
    /** How many wildcards can stretch to match a long name. */
    wildcards: number;
}

/** No wildcards, classes, or escapes: the pattern is a literal name (or suffix). */
const LITERAL = /^[^*?[\\]+$/;

/** A line ending; a final CR counts because Git treats the end of a file as a newline. */
const EOL = /\r?\n|\r$/;

/** Removes unescaped trailing spaces. Tabs are significant, as they are in Git. */
function trimTrailingSpaces(line: string): string {
    let end = line.length;
    let spaces = -1;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === ' ') {
            if (spaces === -1) spaces = i;
        } else {
            if (line[i] === '\\') i++;
            spaces = -1;
        }
    }
    if (spaces !== -1) end = spaces;
    return line.slice(0, end);
}

/**
 * Turns one gitignore line into a regex fragment. Returns `null` for blanks,
 * comments, and malformed patterns, which Git treats as never matching.
 */
export function parseRule(line: string): Rule | null {
    let pattern = trimTrailingSpaces(line);
    if (pattern === '' || pattern.startsWith('#')) return null;

    let negated = false;
    if (pattern.startsWith('!')) {
        negated = true;
        pattern = pattern.slice(1);
    } else if (pattern.startsWith('\\!') || pattern.startsWith('\\#')) {
        pattern = pattern.slice(1);
    }
    if (pattern === '') return null;

    // Git removes exactly one slash at either end; any others must match literally.
    let dirOnly = false;
    if (pattern.endsWith('/')) {
        dirOnly = true;
        pattern = pattern.slice(0, -1);
        if (pattern === '') return null;
    }

    // A slash anywhere but the end anchors the pattern to the ignore file's directory.
    let anchored = false;
    if (pattern.startsWith('/')) {
        anchored = true;
        pattern = pattern.slice(1);
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

    const body = parseGlob(pattern);
    if (body === null) return null;
    // Without a slash, "*" and "?" cannot cross segments, so only the name matters.
    const nameOnly = !anchored && !pattern.includes('/') && !pattern.includes('**');
    const tokens = anchored || nameOnly ? body : [DIRS, ...body];
    const source = tokens.map(tokenSource).join('');
    const wildcards = tokens.filter(isWildcard).length;
    let fast: Rule['fast'] = null;
    if (nameOnly) {
        if (LITERAL.test(pattern)) fast = { kind: 'literal', value: pattern };
        else if (pattern.startsWith('*') && LITERAL.test(pattern.slice(1))) {
            fast = { kind: 'suffix', value: pattern.slice(1) };
        }
    }
    return { negated, dirOnly, nameOnly, fast, source, tokens, wildcards };
}

/**
 * Parses a gitignore glob (already stripped of anchors and trailing slashes).
 * Returns `null` for a malformed pattern.
 */
function parseGlob(glob: string): Token[] | null {
    const out: Token[] = [];
    const n = glob.length;
    for (let i = 0; i < n; i++) {
        const c = glob[i]!;
        if (c === '\\') {
            if (i + 1 >= n) return null; // A trailing backslash is an invalid pattern.
            out.push({ kind: 'char', char: glob[++i]! });
        } else if (c === '*') {
            if (glob[i + 1] === '*') {
                // Collapse any run of stars.
                let j = i + 1;
                while (glob[j] === '*') j++;
                const atStart = i === 0 || glob[i - 1] === '/';
                const atEnd = j === n;
                if (atStart && atEnd) {
                    // "a/**" matches everything inside a.
                    out.push(ALL);
                } else if (atStart && glob[j] === '/') {
                    // "a/**/b" matches zero or more directories.
                    out.push(DIRS);
                    j++;
                } else {
                    // Other consecutive stars are ordinary stars.
                    out.push(STAR);
                }
                i = j - 1;
            } else {
                out.push(STAR);
            }
        } else if (c === '?') {
            out.push(ANY);
        } else if (c === '[') {
            const cls = parseClass(glob, i);
            if (cls === null) return null;
            out.push({ kind: 'class', source: cls.source });
            i = cls.end;
        } else {
            out.push({ kind: 'char', char: c });
        }
    }
    return out;
}

/**
 * Parses a bracket expression starting at `start`, following Git's wildmatch.
 * Returns `null` when it is malformed (not closed, or an unknown POSIX class).
 */
function parseClass(glob: string, start: number): { source: string; end: number } | null {
    let i = start + 1;
    const negate = glob[i] === '!' || glob[i] === '^';
    if (negate) i++;
    let body = '';
    // The character a following `-` would start a range from.
    let rangeStart: string | undefined;
    for (let first = true; ; i++, first = false) {
        const c = glob[i];
        if (c === undefined) return null;
        if (c === ']' && !first) break;
        if (c === '\\') {
            const escaped = glob[++i];
            if (escaped === undefined) return null;
            body += escapeInClass(escaped);
            rangeStart = escaped;
        } else if (c === '-' && rangeStart !== undefined && !isClassEnd(glob[i + 1])) {
            let end = glob[++i]!;
            if (end === '\\') {
                const escaped = glob[++i];
                if (escaped === undefined) return null;
                end = escaped;
            }
            // A reversed range matches nothing. Git accepts it; a regular expression would throw.
            if (rangeStart <= end) body += `${escapeInClass(rangeStart)}-${escapeInClass(end)}`;
            rangeStart = undefined;
        } else if (c === '[' && glob[i + 1] === ':') {
            const close = glob.indexOf(']', i + 2);
            if (close === -1) return null;
            if (glob[close - 1] === ':' && close - 1 >= i + 2) {
                const posix = POSIX_CLASSES[glob.slice(i + 2, close - 1)];
                if (posix === undefined) return null;
                body += posix;
                i = close;
                rangeStart = undefined;
            } else {
                // No closing ":]", so the bracket is an ordinary member.
                body += escapeInClass(c);
                rangeStart = c;
            }
        } else {
            body += escapeInClass(c);
            rangeStart = c;
        }
    }
    // Git never lets a class match a slash, even one it lists.
    return { source: `(?!/)[${negate ? '^' : ''}${body}]`, end: i };
}

function isClassEnd(c: string | undefined): boolean {
    return c === undefined || c === ']';
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
    return /[\\\]^[-]/.test(c) ? `\\${c}` : c;
}
