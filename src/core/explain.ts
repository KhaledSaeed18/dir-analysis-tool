import { lstat, readdir, stat } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { DatError, errorCode } from '../errors.ts';
import type { AnalysisSettings, ScanError } from '../types.ts';
import {
    DEFAULT_EXCLUDES,
    type Excluder,
    type IgnoreChain,
    type IgnoreScope,
    type IgnoreSource,
} from './exclude.ts';
import { GitignoreMatcher, splitRuleLines } from './gitignore.ts';
import { resolveScan, type ScanSettings } from './options.ts';
import { comparePaths, joinRelative } from './paths.ts';
import { Scanner, type ScanOptions, type SkipEvent } from './scanner.ts';

/** Version of the `explain` JSON shape, independent of the analysis `schemaVersion`. */
export const EXPLAIN_VERSION = 1;
/** Default number of entries listed per group by {@link explainSkips}. */
export const DEFAULT_EXPLAIN_LIMIT = 20;
/** Largest accepted `limit` for {@link explainSkips}. */
export const MAX_EXPLAIN_LIMIT = 1000;

/** What a scan with the given settings does with a path. */
export type ExplainDecision = 'included' | 'excluded' | 'filtered' | 'skipped' | 'not-found';

/** What made the decision. */
export type ExplainSource =
    | 'default'
    | 'pattern'
    | 'gitignore'
    | 'info-exclude'
    | 'size'
    | 'date'
    | 'max-depth'
    | 'symlink'
    | 'special-file'
    | 'error'
    | 'unknown';

export type ExplainEntryType = 'file' | 'directory' | 'symlink' | 'other';

export type ExplainNoteCode =
    | 'negation-blocked-by-parent'
    | 'negation-cannot-reach-default'
    | 'negation-cannot-reach-gitignore'
    | 'root-ignored-by-git'
    | 'global-excludes-not-read'
    | 'nested-repository'
    | 'hardlink-order-dependent'
    | 'symlink-order-dependent'
    | 'case-rule-from-platform'
    | 'not-found'
    | 'explanation-unavailable';

/** The rule or limit that decided. Fields that do not apply to the source are `null`. */
export interface ExplainReason {
    source: ExplainSource;
    /** Root-relative path of the entry the rule applied to: the path itself or an ancestor. */
    at: string;
    /** True when `at` is an ancestor, so the path itself was never visited. */
    ancestor: boolean;
    /** `gitignore` and `info-exclude`: the file, relative to the root, `/`-separated. */
    file: string | null;
    /** `gitignore` and `info-exclude`: the 1-based line. */
    line: number | null;
    /**
     * The rule text for `pattern`, `gitignore`, and `info-exclude`; the directory
     * name for `default`; the setting name (`minSize`, `maxSize`, `modifiedAfter`,
     * `modifiedBefore`, `maxDepth`) for `size`, `date`, and `max-depth`.
     */
    rule: string | null;
    /** `pattern`: index into `settings.exclude` (config patterns first, then command-line ones). */
    index: number | null;
    /** `size`, `date`, `max-depth`: the bound (bytes, ISO time, or depth). */
    limit: number | string | null;
    /** `size`, `date`, `max-depth`: the observed value. */
    actual: number | string | null;
    /** `error`, and a dangling `symlink`: the error code. */
    code: string | null;
}

/** Something the explanation cannot settle on its own, or a rule that did not do what it seems to. */
export interface ExplainNote {
    code: ExplainNoteCode;
    message: string;
    path?: string;
    file?: string;
    line?: number;
    rule?: string;
    index?: number;
}

export interface PathExplanation {
    explainVersion: 1;
    root: string;
    /** Root-relative path, `/`-separated; `""` for the root itself. */
    path: string;
    /** Type on disk, or `null` when the path does not exist. */
    type: ExplainEntryType | null;
    decision: ExplainDecision;
    /** `null` when the path is included or not found. */
    reason: ExplainReason | null;
    /** Always `null`: a directory that is never entered is never measured. */
    descendants: null;
    notes: ExplainNote[];
    ignoreCase: boolean;
    settings: AnalysisSettings;
}

export interface ExplainTotals {
    /** Topmost excluded entries, as in `summary.excluded`. */
    excluded: number;
    /** Files dropped by size and date filters, as in `summary.filtered`. */
    filtered: number;
    /** Directories not entered because of `maxDepth`. Not reported by `analyze`. */
    depthSkipped: number;
    /** Symbolic links seen, as in `summary.symlinks`. */
    symlinks: number;
    /** Extra hard links not counted again, as in `summary.hardlinks`. */
    hardlinks: number;
    errors: number;
}

/** Entries skipped for the same reason. */
export interface ExplainGroup {
    source: ExplainSource;
    file: string | null;
    line: number | null;
    rule: string | null;
    index: number | null;
    limit: number | string | null;
    count: number;
    /** The first entries in path order, at most `limit` of them. */
    entries: string[];
    truncated: boolean;
}

export interface SkipsExplanation {
    explainVersion: 1;
    root: string;
    totals: ExplainTotals;
    /** Largest groups first. */
    groups: ExplainGroup[];
    /** Unreadable entries, at most `limit` (and at most 100) of them. */
    errors: ScanError[];
    notes: ExplainNote[];
    limit: number;
    ignoreCase: boolean;
    settings: AnalysisSettings;
}

export interface ExplainSkipsOptions extends ScanSettings {
    /** Entries listed per group. Counts are always complete. Default: 20, maximum 1000. */
    limit?: number | undefined;
}

// ---------------------------------------------------------------------------
// Rule identity
// ---------------------------------------------------------------------------

interface LineRule {
    line: number;
    text: string;
    matcher: GitignoreMatcher;
}

interface RuleMatch {
    rule: LineRule;
    ignored: boolean;
}

interface ScopeMatch extends RuleMatch {
    scope: IgnoreScope;
    local: string;
}

type Verdict =
    | { source: 'default'; name: string }
    | { source: 'pattern'; match: RuleMatch; index: number }
    | { source: 'gitignore' | 'info-exclude'; match: ScopeMatch };

interface Matched {
    verdict: Verdict | null;
    user: RuleMatch | undefined;
    git: ScopeMatch | undefined;
}

function compileLines(lines: readonly string[], ignoreCase: boolean): LineRule[] {
    const rules: LineRule[] = [];
    for (let i = 0; i < lines.length; i++) {
        const text = lines[i]!;
        const matcher = GitignoreMatcher.compile([text], { ignoreCase });
        if (matcher.hasRules) rules.push({ line: i + 1, text, matcher });
    }
    return rules;
}

function lastMatch(
    rules: readonly LineRule[],
    path: string,
    isDirectory: boolean
): RuleMatch | undefined {
    for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i]!;
        const result = rule.matcher.test(path, isDirectory);
        if (result !== undefined) return { rule, ignored: result };
    }
    return undefined;
}

/**
 * Re-evaluates the {@link Excluder}'s decision one rule at a time, so the
 * deciding rule's file and line are known. Ordinary scans never build this:
 * their matcher merges rules for speed and keeps no rule identity.
 */
class RuleBook {
    readonly #excluder: Excluder;
    readonly #root: string;
    readonly #user: LineRule[];
    /** Maps each compiled user rule (`line` is its position in the trimmed list) to `settings.exclude`. */
    readonly #userIndex: number[];
    readonly #files = new WeakMap<IgnoreSource, LineRule[]>();
    readonly #defaults: ReadonlySet<string> | null;

    constructor(excluder: Excluder, root: string, rawPatterns: readonly string[]) {
        this.#excluder = excluder;
        this.#root = root;
        this.#defaults = excluder.defaultExcludes ? new Set(DEFAULT_EXCLUDES) : null;
        const trimmed: string[] = [];
        this.#userIndex = [];
        rawPatterns.forEach((raw, index) => {
            const text = raw.trim();
            if (!text) return;
            trimmed.push(text);
            this.#userIndex.push(index);
        });
        this.#user = compileLines(trimmed, excluder.ignoreCase);
    }

    get ignoreCase(): boolean {
        return this.#excluder.ignoreCase;
    }

    rulesOf(source: IgnoreSource): LineRule[] {
        let rules = this.#files.get(source);
        if (rules === undefined) {
            rules = compileLines(splitRuleLines(source.content), this.ignoreCase);
            this.#files.set(source, rules);
        }
        return rules;
    }

    /** Root-relative, `/`-separated name of an ignore file. */
    fileName(source: IgnoreSource): string {
        return relative(this.#root, source.file).split(sep).join('/');
    }

    userIndex(rule: LineRule): number {
        return this.#userIndex[rule.line - 1]!;
    }

    /** The same checks, in the same order, as `Excluder.isExcluded`. */
    match(relPath: string, name: string, isDirectory: boolean, chain: IgnoreChain): Matched {
        const user = lastMatch(this.#user, relPath, isDirectory);
        const git = this.#excluder.gitignore
            ? this.#gitMatch(chain, relPath, isDirectory)
            : undefined;
        let verdict: Verdict | null = null;
        if (isDirectory && this.#defaults?.has(name)) verdict = { source: 'default', name };
        else if (user?.ignored === true) {
            verdict = { source: 'pattern', match: user, index: this.userIndex(user.rule) };
        } else if (git?.ignored === true) {
            verdict = { source: git.scope.source.kind, match: git };
        }
        return { verdict, user, git };
    }

    #gitMatch(chain: IgnoreChain, relPath: string, isDirectory: boolean): ScopeMatch | undefined {
        for (let i = chain.length - 1; i >= 0; i--) {
            const scope = chain[i]!;
            const local = scope.prefix + relPath.slice(scope.strip);
            if (local === '') continue;
            const found = lastMatch(this.rulesOf(scope.source), local, isDirectory);
            if (found) return { ...found, scope, local };
        }
        return undefined;
    }

    /** True when a rule matched only because matching ignores case. */
    reliesOnCase(rule: LineRule, path: string, isDirectory: boolean): boolean {
        if (!this.ignoreCase) return false;
        return GitignoreMatcher.compile([rule.text]).test(path, isDirectory) !== true;
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function emptyReason(source: ExplainSource, at: string, ancestor: boolean): ExplainReason {
    return {
        source,
        at,
        ancestor,
        file: null,
        line: null,
        rule: null,
        index: null,
        limit: null,
        actual: null,
        code: null,
    };
}

function reasonFromVerdict(
    book: RuleBook,
    verdict: Verdict | null,
    at: string,
    ancestor: boolean
): ExplainReason {
    if (verdict === null) return emptyReason('unknown', at, ancestor);
    const reason = emptyReason(verdict.source, at, ancestor);
    if (verdict.source === 'default') {
        reason.rule = verdict.name;
    } else if (verdict.source === 'pattern') {
        reason.rule = verdict.match.rule.text;
        reason.index = verdict.index;
    } else {
        reason.file = book.fileName(verdict.match.scope.source);
        reason.line = verdict.match.rule.line;
        reason.rule = verdict.match.rule.text;
    }
    return reason;
}

function ruleNote(
    book: RuleBook,
    code: ExplainNoteCode,
    match: RuleMatch | ScopeMatch,
    message: string
): ExplainNote {
    if ('scope' in match) {
        return {
            code,
            message,
            file: book.fileName(match.scope.source),
            line: match.rule.line,
            rule: match.rule.text,
        };
    }
    return { code, message, rule: match.rule.text, index: book.userIndex(match.rule) };
}

function describeRule(book: RuleBook, match: RuleMatch | ScopeMatch): string {
    if ('scope' in match) {
        return `${book.fileName(match.scope.source)}:${match.rule.line} ${match.rule.text}`;
    }
    return `exclude pattern ${match.rule.text}`;
}

/** Notes about rules that look like they should have changed an exclusion but cannot. */
function verdictNotes(
    book: RuleBook,
    matched: Matched,
    relPath: string,
    isDirectory: boolean
): ExplainNote[] {
    const notes: ExplainNote[] = [];
    const { verdict, user, git } = matched;
    if (verdict?.source === 'default') {
        for (const negation of [user, git]) {
            if (negation?.ignored !== false) continue;
            notes.push(
                ruleNote(
                    book,
                    'negation-cannot-reach-default',
                    negation,
                    `${describeRule(book, negation)} has no effect: ${verdict.name} is a default exclude. Use --all to include it.`
                )
            );
        }
    } else if (
        (verdict?.source === 'gitignore' || verdict?.source === 'info-exclude') &&
        user?.ignored === false
    ) {
        notes.push(
            ruleNote(
                book,
                'negation-cannot-reach-gitignore',
                user,
                `${describeRule(book, user)} has no effect: exclude patterns are checked before .gitignore and cannot re-include what it ignores.`
            )
        );
    }
    if (verdict !== null && verdict.source !== 'default') {
        const match = verdict.match;
        const path = 'scope' in match ? match.local : relPath;
        if (match.ignored && book.reliesOnCase(match.rule, path, isDirectory)) {
            notes.push(
                ruleNote(
                    book,
                    'case-rule-from-platform',
                    match,
                    `${describeRule(book, match)} matches only because matching ignores case on this platform; Git follows the repository's core.ignorecase instead.`
                )
            );
        }
    }
    return notes;
}

function globalExcludesNote(): ExplainNote {
    return {
        code: 'global-excludes-not-read',
        message:
            "Git's global excludes file (core.excludesFile, usually ~/.config/git/ignore) is not read; Git may ignore more than dat does.",
    };
}

/**
 * When the root sits inside a repository, reports the first directory between
 * the repository root and the scan root that Git ignores. dat scans it anyway,
 * because it was asked to.
 */
function rootIgnoredNote(
    book: RuleBook,
    root: string,
    repoRoot: string,
    chain: IgnoreChain
): ExplainNote | null {
    const parts = relative(repoRoot, root).split(sep).filter(Boolean);
    for (let k = 1; k <= parts.length; k++) {
        const abs = resolve(repoRoot, ...parts.slice(0, k));
        for (let i = chain.length - 1; i >= 0; i--) {
            const scope = chain[i]!;
            const base =
                scope.source.kind === 'info-exclude' ? repoRoot : dirname(scope.source.file);
            const local = relative(base, abs);
            if (local === '' || local.startsWith('..') || isAbsolute(local)) continue;
            const found = lastMatch(book.rulesOf(scope.source), local.split(sep).join('/'), true);
            if (found === undefined) continue;
            if (!found.ignored) break;
            const path = parts.slice(0, k).join('/');
            return {
                code: 'root-ignored-by-git',
                message: `Git ignores ${path} (${book.fileName(scope.source)}:${found.rule.line} ${found.rule.text}), which contains the scan root. dat scans the root anyway because it was asked to.`,
                path,
                file: book.fileName(scope.source),
                line: found.rule.line,
                rule: found.rule.text,
            };
        }
    }
    return null;
}

function nestedRepositoryNote(path: string): ExplainNote {
    return {
        code: 'nested-repository',
        message: `${path} is a separate Git repository: rules from outside it still apply, and its own .git/info/exclude is not read.`,
        path,
    };
}

function hardlinkNote(path?: string): ExplainNote {
    return {
        code: 'hardlink-order-dependent',
        message:
            'A file with several hard links is counted once; which of its paths is counted depends on scan order.',
        ...(path === undefined ? {} : { path }),
    };
}

function symlinkOrderNote(path?: string): ExplainNote {
    return {
        code: 'symlink-order-dependent',
        message:
            'With --follow-symlinks, a directory reached by several paths is entered once; which path depends on scan order.',
        ...(path === undefined ? {} : { path }),
    };
}

function filterReason(
    options: ScanOptions,
    stats: Stats,
    at: string,
    ancestor: boolean
): ExplainReason | null {
    const size = stats.size;
    const mtime = stats.mtimeMs;
    const make = (
        source: 'size' | 'date',
        rule: string,
        limit: number | string,
        actual: number | string
    ): ExplainReason => ({
        ...emptyReason(source, at, ancestor),
        rule,
        limit,
        actual,
    });
    if (size < options.minSize) return make('size', 'minSize', options.minSize, size);
    if (size > options.maxSize) return make('size', 'maxSize', options.maxSize, size);
    const iso = (ms: number): string => new Date(ms).toISOString();
    if (mtime < options.modifiedAfter) {
        return make('date', 'modifiedAfter', iso(options.modifiedAfter), iso(mtime));
    }
    if (mtime > options.modifiedBefore) {
        return make('date', 'modifiedBefore', iso(options.modifiedBefore), iso(mtime));
    }
    return null;
}

function entryType(stats: Stats | Dirent): ExplainEntryType {
    if (stats.isSymbolicLink()) return 'symlink';
    if (stats.isDirectory()) return 'directory';
    if (stats.isFile()) return 'file';
    return 'other';
}

function isSpecial(entry: Dirent): boolean {
    return entry.isBlockDevice() || entry.isCharacterDevice() || entry.isFIFO() || entry.isSocket();
}

// ---------------------------------------------------------------------------
// explainPath
// ---------------------------------------------------------------------------

/**
 * Explains what a scan of `root` with these settings does with one path:
 * whether it is counted, and if not, which rule or limit decided and where.
 *
 * Runs no full scan. It walks from the root down to the path the way the
 * scanner does, reading only the directories on the way, and stops at the
 * first ancestor the scan would not enter. `path` is relative to `root` or
 * absolute; it must be inside `root`.
 *
 * @example
 * ```ts
 * import { explainPath } from 'dir-analysis-tool';
 *
 * const result = await explainPath('.', 'build/keep/k.txt', { gitignore: true });
 * console.log(result.decision, result.reason?.file, result.reason?.line);
 * ```
 */
export async function explainPath(
    root: string,
    path: string,
    settings: ScanSettings = {}
): Promise<PathExplanation> {
    const { options, settings: resolved } = await resolveScan(root, settings, Date.now());
    const absRoot = options.root;
    const target = resolve(absRoot, path);
    const fromRoot = relative(absRoot, target);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new DatError(`${path} is outside the root ${absRoot}.`, {
            hint: 'Pass the directory that contains it with --root.',
        });
    }
    const relPath = fromRoot.split(sep).join('/');
    const segments = relPath ? relPath.split('/') : [];
    const excluder = options.excluder;
    const book = new RuleBook(excluder, absRoot, resolved.exclude);
    const notes: ExplainNote[] = [];
    const { chain: ancestors, repoRoot } = await excluder.loadAncestors(absRoot);
    if (excluder.gitignore && repoRoot !== null) {
        notes.push(globalExcludesNote());
        if (repoRoot !== absRoot) {
            const note = rootIgnoredNote(book, absRoot, repoRoot, ancestors);
            if (note) notes.push(note);
        }
    }

    const result = (
        decision: ExplainDecision,
        type: ExplainEntryType | null,
        reason: ExplainReason | null,
        displayPath: string = relPath
    ): PathExplanation => ({
        explainVersion: EXPLAIN_VERSION,
        root: absRoot,
        path: displayPath,
        type,
        decision,
        reason,
        descendants: null,
        // General disclosures last, so the notes about this path come first.
        notes: [
            ...notes.filter((n) => n.code !== 'global-excludes-not-read'),
            ...notes.filter((n) => n.code === 'global-excludes-not-read'),
        ],
        ignoreCase: excluder.ignoreCase,
        settings: resolved,
    });

    if (segments.length === 0) return result('included', 'directory', null);

    const targetType = async (): Promise<ExplainEntryType | null> => {
        const stats = await lstat(target).catch(() => null);
        return stats === null ? null : entryType(stats);
    };

    const chain: IgnoreScope[] = [...ancestors];
    let dirAbs = absRoot;
    let relDir = '';
    let depth = 0;
    const onDisk: string[] = [];
    for (let i = 0; i < segments.length; i++) {
        const isLast = i === segments.length - 1;
        let entries: Dirent[];
        try {
            entries = await readdir(dirAbs, { withFileTypes: true });
        } catch (error) {
            const reason = emptyReason('error', relDir, true);
            reason.code = errorCode(error) ?? 'UNKNOWN';
            return result('skipped', await targetType(), reason);
        }
        if (i > 0 && entries.some((e) => e.name === '.git')) {
            notes.push(nestedRepositoryNote(relDir));
        }
        if (
            excluder.gitignore &&
            entries.some((e) => e.name === '.gitignore' && !e.isDirectory())
        ) {
            const scope = await excluder.loadScope(joinRelative(dirAbs, '.gitignore'), relDir);
            if (scope) chain.push(scope);
        }

        const wanted = segments[i]!;
        let entry = entries.find((e) => e.name === wanted);
        if (entry === undefined && excluder.ignoreCase) {
            // A case-insensitive file system accepts the name in any case; use the name on disk.
            const lower = wanted.toLowerCase();
            const candidates = entries.filter((e) => e.name.toLowerCase() === lower);
            if (candidates.length === 1) entry = candidates[0];
        }
        if (entry === undefined) return result('not-found', null, null);
        const name = entry.name;
        onDisk.push(name);
        const entryRel = relDir ? `${relDir}/${name}` : name;
        const fullPath = joinRelative(dirAbs, name);
        const shownPath = (): string => [...onDisk, ...segments.slice(i + 1)].join('/');

        const isDirectory = entry.isDirectory();
        const isFile = !isDirectory && entry.isFile();
        if (!isDirectory && !isFile && !entry.isSymbolicLink() && isSpecial(entry)) {
            return result(
                isLast ? 'skipped' : 'not-found',
                isLast ? 'other' : null,
                isLast ? emptyReason('special-file', entryRel, false) : null,
                shownPath()
            );
        }

        const excluded = async (asDirectory: boolean): Promise<PathExplanation> => {
            const matched = book.match(entryRel, name, asDirectory, chain);
            const reason = reasonFromVerdict(book, matched.verdict, entryRel, !isLast);
            if (matched.verdict === null) {
                notes.push({
                    code: 'explanation-unavailable',
                    message: `The scan excludes ${entryRel}, but no single rule could be identified as the reason.`,
                    path: entryRel,
                });
            }
            notes.push(...verdictNotes(book, matched, entryRel, asDirectory));
            const type = await targetType();
            if (!isLast) {
                // The descendants are never visited; say whether a later rule looked like it would re-include them.
                for (let j = i + 1; j < segments.length; j++) {
                    const below = [entryRel, ...segments.slice(i + 1, j + 1)].join('/');
                    const belowIsDirectory = j < segments.length - 1 || type === 'directory';
                    const inner = book.match(below, segments[j]!, belowIsDirectory, chain);
                    const negation = [inner.user, inner.git].find((m) => m?.ignored === false);
                    if (negation) {
                        notes.push(
                            ruleNote(
                                book,
                                'negation-blocked-by-parent',
                                negation,
                                `${describeRule(book, negation)} cannot re-include this: its parent directory ${entryRel} is excluded.`
                            )
                        );
                        break;
                    }
                }
                if (type === null) {
                    notes.push({
                        code: 'not-found',
                        message: `${shownPath()} does not exist; its excluded ancestor decides anyway.`,
                        path: shownPath(),
                    });
                }
            }
            return result('excluded', type, reason, shownPath());
        };

        const accept = async (stats: Stats, type: ExplainEntryType): Promise<PathExplanation> => {
            if (!options.countHardlinks && stats.nlink > 1) notes.push(hardlinkNote(entryRel));
            const reason = filterReason(options, stats, entryRel, false);
            return result(reason ? 'filtered' : 'included', type, reason, shownPath());
        };

        const enter = async (type: ExplainEntryType): Promise<PathExplanation | null> => {
            if (depth + 1 > options.maxDepth) {
                const reason = emptyReason('max-depth', entryRel, !isLast);
                reason.rule = 'maxDepth';
                reason.limit = options.maxDepth;
                reason.actual = depth + 1;
                return result('skipped', isLast ? type : await targetType(), reason, shownPath());
            }
            if (isLast) return result('included', type, null, shownPath());
            dirAbs = fullPath;
            relDir = entryRel;
            depth++;
            return null;
        };

        if (excluder.active && excluder.isExcluded(entryRel, name, isDirectory, chain)) {
            return excluded(isDirectory);
        }

        if (isDirectory && !options.followSymlinks) {
            const done = await enter('directory');
            if (done) return done;
            continue;
        }

        if (isFile) {
            if (!isLast) return result('not-found', null, null);
            let stats: Stats;
            try {
                stats = await lstat(fullPath);
            } catch (error) {
                const reason = emptyReason('error', entryRel, false);
                reason.code = errorCode(error) ?? 'UNKNOWN';
                return result('skipped', 'file', reason);
            }
            return accept(stats, 'file');
        }

        // Symbolic links, unknown types, and (with followSymlinks) directories, as in the scanner.
        let stats: Stats;
        let isSymlink = entry.isSymbolicLink();
        try {
            stats = await lstat(fullPath);
            if (stats.isSymbolicLink()) {
                isSymlink = true;
                if (!options.followSymlinks) {
                    const reason = emptyReason('symlink', entryRel, !isLast);
                    return result(
                        'skipped',
                        isLast ? 'symlink' : await targetType(),
                        reason,
                        shownPath()
                    );
                }
                stats = await stat(fullPath);
            }
        } catch (error) {
            const code = errorCode(error) ?? 'UNKNOWN';
            const dangling = isSymlink && (code === 'ENOENT' || code === 'ELOOP');
            const reason = emptyReason(dangling ? 'symlink' : 'error', entryRel, !isLast);
            reason.code = code;
            return result(
                'skipped',
                isLast ? (isSymlink ? 'symlink' : null) : null,
                reason,
                shownPath()
            );
        }
        const type: ExplainEntryType = isSymlink ? 'symlink' : entryType(stats);
        if (stats.isDirectory()) {
            if (
                excluder.active &&
                !isDirectory &&
                excluder.isExcluded(entryRel, name, true, chain)
            ) {
                return excluded(true);
            }
            if (isSymlink) notes.push(symlinkOrderNote(entryRel));
            const done = await enter(type);
            if (done) return done;
            continue;
        }
        if (!isLast) return result('not-found', null, null);
        if (stats.isFile()) return accept(stats, type);
        return result('skipped', type, emptyReason('special-file', entryRel, false), shownPath());
    }
    /* c8 ignore next */
    return result('not-found', null, null);
}

// ---------------------------------------------------------------------------
// explainSkips
// ---------------------------------------------------------------------------

/** Keeps the first `limit` paths in path order, whatever order they arrive in. */
class Sample {
    readonly #limit: number;
    readonly items: string[] = [];
    count = 0;

    constructor(limit: number) {
        this.#limit = limit;
    }

    add(path: string): void {
        this.count++;
        const items = this.items;
        if (this.#limit === 0) return;
        if (items.length === this.#limit && comparePaths(path, items.at(-1)!) >= 0) return;
        let lo = 0;
        let hi = items.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (comparePaths(items[mid]!, path) < 0) lo = mid + 1;
            else hi = mid;
        }
        items.splice(lo, 0, path);
        if (items.length > this.#limit) items.pop();
    }
}

interface GroupState {
    group: Omit<ExplainGroup, 'count' | 'entries' | 'truncated'>;
    sample: Sample;
}

const SOURCE_ORDER: readonly ExplainSource[] = [
    'default',
    'pattern',
    'info-exclude',
    'gitignore',
    'size',
    'date',
    'max-depth',
    'symlink',
    'special-file',
    'error',
    'unknown',
];

/**
 * Runs one scan and reports everything it left out, grouped by the rule or
 * limit that decided: default excludes, each `exclude` pattern, each
 * `.gitignore` line, size and date filters, `maxDepth`, and symbolic links
 * that were not followed. Counts are complete; each group lists at most
 * `limit` entries, the first in path order.
 *
 * Totals equal the `summary` counters of {@link analyze} with the same
 * settings. Sizes inside excluded directories are never measured.
 */
export async function explainSkips(
    root: string,
    options: ExplainSkipsOptions = {}
): Promise<SkipsExplanation> {
    const limit = options.limit ?? DEFAULT_EXPLAIN_LIMIT;
    if (!Number.isInteger(limit) || limit < 0 || limit > MAX_EXPLAIN_LIMIT) {
        throw new DatError(
            `limit must be a whole number from 0 to ${MAX_EXPLAIN_LIMIT} (got ${limit}).`
        );
    }
    const { options: scanOptions, settings } = await resolveScan(root, options, Date.now());
    const absRoot = scanOptions.root;
    const excluder = scanOptions.excluder;
    const book = new RuleBook(excluder, absRoot, settings.exclude);
    const groups = new Map<string, GroupState>();
    const notes = new Map<string, ExplainNote>();
    let depthSkipped = 0;

    const addNote = (note: ExplainNote): void => {
        const key = `${note.code}\0${note.file ?? ''}\0${note.line ?? ''}\0${note.rule ?? ''}\0${note.index ?? ''}`;
        if (!notes.has(key)) notes.set(key, note);
    };
    const groupFor = (key: string, make: () => GroupState['group']): Sample => {
        let state = groups.get(key);
        if (state === undefined) {
            state = { group: make(), sample: new Sample(limit) };
            groups.set(key, state);
        }
        return state.sample;
    };
    const base = (source: ExplainSource): GroupState['group'] => ({
        source,
        file: null,
        line: null,
        rule: null,
        index: null,
        limit: null,
    });

    let scanner: Scanner | null = null;
    const onSkip = (event: SkipEvent): void => {
        const rel = scanner!.relativePath(event.dir, event.name);
        switch (event.kind) {
            case 'excluded': {
                const matched = book.match(rel, event.name, event.isDirectory, event.chain);
                for (const note of verdictNotes(book, matched, rel, event.isDirectory)) {
                    addNote(note);
                }
                const verdict = matched.verdict;
                let sample: Sample;
                if (verdict === null) {
                    addNote({
                        code: 'explanation-unavailable',
                        message:
                            'Some exclusions could not be traced to a single rule; they are grouped as "unknown".',
                    });
                    sample = groupFor('unknown', () => base('unknown'));
                } else if (verdict.source === 'default') {
                    sample = groupFor(`default\0${verdict.name}`, () => ({
                        ...base('default'),
                        rule: verdict.name,
                    }));
                } else if (verdict.source === 'pattern') {
                    sample = groupFor(`pattern\0${verdict.index}`, () => ({
                        ...base('pattern'),
                        rule: verdict.match.rule.text,
                        index: verdict.index,
                    }));
                } else {
                    const { scope, rule } = verdict.match;
                    sample = groupFor(
                        `${verdict.source}\0${scope.source.file}\0${rule.line}`,
                        () => ({
                            ...base(verdict.source),
                            file: book.fileName(scope.source),
                            line: rule.line,
                            rule: rule.text,
                        })
                    );
                }
                sample.add(rel);
                return;
            }
            case 'filtered': {
                const reason = filterReason(scanOptions, event.stats, rel, false)!;
                groupFor(`${reason.source}\0${reason.rule}`, () => ({
                    ...base(reason.source),
                    rule: reason.rule,
                    limit: reason.limit,
                })).add(rel);
                return;
            }
            case 'depth':
                depthSkipped++;
                groupFor('max-depth', () => ({
                    ...base('max-depth'),
                    rule: 'maxDepth',
                    limit: scanOptions.maxDepth,
                })).add(rel);
                return;
            case 'symlink':
                groupFor('symlink', () => base('symlink')).add(rel);
                return;
        }
    };

    scanner = new Scanner({ ...scanOptions, onSkip }, { file() {} });
    await scanner.run();

    const rootNotes: ExplainNote[] = [];
    if (excluder.gitignore) {
        const { chain, repoRoot } = await excluder.loadAncestors(absRoot);
        if (repoRoot !== null) {
            rootNotes.push(globalExcludesNote());
            if (repoRoot !== absRoot) {
                const note = rootIgnoredNote(book, absRoot, repoRoot, chain);
                if (note) rootNotes.push(note);
            }
        }
    }
    const counters = scanner.counters;
    if (counters.hardlinks > 0) rootNotes.push(hardlinkNote());
    if (scanOptions.followSymlinks && counters.symlinks > 0) rootNotes.push(symlinkOrderNote());

    const sorted = [...groups.values()]
        .map(({ group, sample }) => ({
            ...group,
            count: sample.count,
            entries: sample.items,
            truncated: sample.count > sample.items.length,
        }))
        .toSorted(
            (a, b) =>
                b.count - a.count ||
                SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) ||
                comparePaths(a.file ?? '', b.file ?? '') ||
                (a.line ?? 0) - (b.line ?? 0) ||
                (a.index ?? 0) - (b.index ?? 0) ||
                comparePaths(a.rule ?? '', b.rule ?? '')
        );

    return {
        explainVersion: EXPLAIN_VERSION,
        root: absRoot,
        totals: {
            excluded: counters.excluded,
            filtered: counters.filtered,
            depthSkipped,
            symlinks: counters.symlinks,
            hardlinks: counters.hardlinks,
            errors: counters.errors,
        },
        groups: sorted,
        errors: scanner.errors.slice(0, limit),
        notes: [...rootNotes, ...notes.values()],
        limit,
        ignoreCase: excluder.ignoreCase,
        settings,
    };
}
