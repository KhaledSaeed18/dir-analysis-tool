import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { GitignoreMatcher } from './gitignore.ts';

/** Directories skipped unless default excludes are turned off. */
export const DEFAULT_EXCLUDES: readonly string[] = ['.git', '.hg', '.svn', 'node_modules'];

export interface ExcludeOptions {
    /** Gitignore-style patterns, relative to the scan root. */
    patterns?: readonly string[];
    /** Skip {@link DEFAULT_EXCLUDES}. Defaults to true. */
    defaultExcludes?: boolean;
    /** Honor `.gitignore` files (and `.git/info/exclude`). Defaults to false. */
    gitignore?: boolean;
    /** Case-insensitive matching. Defaults to the platform convention (true on macOS and Windows). */
    ignoreCase?: boolean;
}

/**
 * One `.gitignore` file. Paths are tested relative to the directory that holds
 * it: `local = prefix + rootRelativePath.slice(strip)`.
 */
export interface IgnoreScope {
    readonly matcher: GitignoreMatcher;
    readonly prefix: string;
    readonly strip: number;
    /** Where the rules came from; read only by `explain`, which needs rule identity. */
    readonly source: IgnoreSource;
}

/** The file behind an {@link IgnoreScope}, kept so an explanation can name a rule's line. */
export interface IgnoreSource {
    readonly kind: 'gitignore' | 'info-exclude';
    /** Absolute path of the file. */
    readonly file: string;
    readonly content: string;
}

/** The gitignore files that apply to a directory, outermost first. */
export type IgnoreChain = readonly IgnoreScope[];

const EMPTY_CHAIN: IgnoreChain = [];

/**
 * Decides which entries a scan skips. Combines the default excluded directory
 * names, user patterns (gitignore syntax, relative to the root), and optionally
 * the repository's own `.gitignore` files, evaluated with Git's precedence:
 * deeper files override shallower ones, and later rules override earlier ones.
 */
export class Excluder {
    readonly gitignore: boolean;
    readonly #defaults: ReadonlySet<string> | null;
    readonly #user: GitignoreMatcher | null;
    readonly #ignoreCase: boolean;
    /** Trimmed, non-empty user patterns, as they were compiled. */
    readonly patterns: readonly string[];

    constructor(options: ExcludeOptions = {}) {
        this.gitignore = options.gitignore ?? false;
        this.#ignoreCase = options.ignoreCase ?? process.platform !== 'linux';
        this.#defaults = (options.defaultExcludes ?? true) ? new Set(DEFAULT_EXCLUDES) : null;
        const patterns = (options.patterns ?? []).map((p) => p.trim()).filter(Boolean);
        this.patterns = patterns;
        const user = patterns.length > 0 ? this.#compile(patterns) : null;
        this.#user = user?.hasRules ? user : null;
    }

    /** Whether rules match case-insensitively. */
    get ignoreCase(): boolean {
        return this.#ignoreCase;
    }

    /** Whether the default directory names are excluded. */
    get defaultExcludes(): boolean {
        return this.#defaults !== null;
    }

    /** True when at least one rule could exclude something. */
    get active(): boolean {
        return this.#defaults !== null || this.#user !== null || this.gitignore;
    }

    /** Whether path-based rules exist (anything beyond default directory names). */
    get needsPaths(): boolean {
        return this.#user !== null || this.gitignore;
    }

    /**
     * @param relPath Root-relative path with `/` separators.
     * @param name Entry name (the last segment of `relPath`).
     */
    isExcluded(relPath: string, name: string, isDirectory: boolean, chain: IgnoreChain): boolean {
        if (isDirectory && this.#defaults?.has(name)) return true;
        if (this.#user !== null && this.#user.test(relPath, isDirectory) === true) return true;
        return chain.length > 0 && isGitIgnored(chain, relPath, isDirectory);
    }

    /**
     * Checks a path and each of its ancestors against the default and user
     * rules. Used to filter filesystem events in watch mode.
     */
    isPathExcluded(relPath: string): boolean {
        const segments = relPath.split('/').filter(Boolean);
        let current = '';
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i]!;
            current = current ? `${current}/${segment}` : segment;
            const isLast = i === segments.length - 1;
            if (!isLast && this.isExcluded(current, segment, true, EMPTY_CHAIN)) return true;
            if (isLast) {
                return (
                    this.isExcluded(current, segment, false, EMPTY_CHAIN) ||
                    (this.#defaults?.has(segment) ?? false)
                );
            }
        }
        return false;
    }

    /** Builds the scope for a `.gitignore` found at `rootRelativeDir` (`''` for the root). */
    async loadScope(filePath: string, rootRelativeDir: string): Promise<IgnoreScope | null> {
        const content = await readFile(filePath, 'utf8').catch(() => null);
        if (content === null) return null;
        const matcher = this.#compile(content);
        if (!matcher.hasRules) return null;
        return {
            matcher,
            prefix: '',
            strip: rootRelativeDir ? rootRelativeDir.length + 1 : 0,
            source: { kind: 'gitignore', file: filePath, content },
        };
    }

    /**
     * When the root sits inside a Git repository, collects the `.gitignore`
     * files of its ancestors up to the repository root, plus
     * `.git/info/exclude`, so a sub-directory scan matches Git's view.
     */
    async loadAncestorChain(root: string): Promise<IgnoreChain> {
        return (await this.loadAncestors(root)).chain;
    }

    /** {@link loadAncestorChain}, plus the repository root it found (null outside a repository). */
    async loadAncestors(root: string): Promise<{ chain: IgnoreChain; repoRoot: string | null }> {
        if (!this.gitignore) return { chain: EMPTY_CHAIN, repoRoot: null };
        const ancestors: string[] = [];
        let repoRoot: string | null = null;
        let current = root;
        for (;;) {
            if (existsSync(join(current, '.git'))) {
                repoRoot = current;
                break;
            }
            const parent = dirname(current);
            if (parent === current) break;
            ancestors.push(parent);
            current = parent;
        }
        if (repoRoot === null) return { chain: EMPTY_CHAIN, repoRoot: null };

        const scopes: IgnoreScope[] = [];
        const outermostFirst = repoRoot === root ? [] : ancestors.reverse();
        const add = async (
            file: string,
            base: string,
            kind: IgnoreSource['kind']
        ): Promise<void> => {
            const content = await readFile(file, 'utf8').catch(() => null);
            if (content === null) return;
            const matcher = this.#compile(content);
            if (!matcher.hasRules) return;
            const prefix = relative(base, root).split(sep).join('/');
            scopes.push({
                matcher,
                prefix: prefix ? `${prefix}/` : '',
                strip: 0,
                source: { kind, file, content },
            });
        };
        const infoExclude = await findInfoExclude(repoRoot);
        if (infoExclude !== null) await add(infoExclude, repoRoot, 'info-exclude');
        for (const dir of outermostFirst) await add(join(dir, '.gitignore'), dir, 'gitignore');
        return { chain: scopes, repoRoot };
    }

    #compile(source: string | readonly string[]): GitignoreMatcher {
        return GitignoreMatcher.compile(source, { ignoreCase: this.#ignoreCase });
    }
}

/**
 * Locates `info/exclude`. In a linked worktree or a submodule `.git` is a file
 * naming the real Git directory, and a worktree shares its main repository's
 * exclude file through `commondir`.
 */
async function findInfoExclude(repoRoot: string): Promise<string | null> {
    const dotGit = join(repoRoot, '.git');
    const pointer = await readFile(dotGit, 'utf8').catch(() => null);
    if (pointer === null) return join(dotGit, 'info', 'exclude');
    const gitDir = /^gitdir:\s*(.+?)\s*$/m.exec(pointer)?.[1];
    if (gitDir === undefined) return null;
    const dir = resolve(repoRoot, gitDir);
    const commonDir = await readFile(join(dir, 'commondir'), 'utf8').catch(() => null);
    return join(commonDir === null ? dir : resolve(dir, commonDir.trim()), 'info', 'exclude');
}

function isGitIgnored(chain: IgnoreChain, relPath: string, isDirectory: boolean): boolean {
    let ignored = false;
    for (const scope of chain) {
        const local = scope.prefix + relPath.slice(scope.strip);
        if (local === '') continue;
        const result = scope.matcher.test(local, isDirectory);
        if (result !== undefined) ignored = result;
    }
    return ignored;
}
