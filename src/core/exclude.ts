import { readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
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
interface IgnoreScope {
    readonly matcher: GitignoreMatcher;
    readonly prefix: string;
    readonly strip: number;
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

    constructor(options: ExcludeOptions = {}) {
        this.gitignore = options.gitignore ?? false;
        this.#ignoreCase = options.ignoreCase ?? process.platform !== 'linux';
        this.#defaults = (options.defaultExcludes ?? true) ? new Set(DEFAULT_EXCLUDES) : null;
        const patterns = (options.patterns ?? []).map((p) => p.trim()).filter(Boolean);
        const user = patterns.length > 0 ? this.#compile(patterns) : null;
        this.#user = user?.hasRules ? user : null;
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
        };
    }

    /**
     * When the root sits inside a Git repository, collects the `.gitignore`
     * files of its ancestors up to the repository root, plus
     * `.git/info/exclude`, so a sub-directory scan matches Git's view.
     */
    async loadAncestorChain(root: string): Promise<IgnoreChain> {
        if (!this.gitignore) return EMPTY_CHAIN;
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
        if (repoRoot === null) return EMPTY_CHAIN;

        const scopes: IgnoreScope[] = [];
        const outermostFirst = repoRoot === root ? [] : ancestors.reverse();
        const add = async (file: string, base: string): Promise<void> => {
            const content = await readFile(file, 'utf8').catch(() => null);
            if (content === null) return;
            const matcher = this.#compile(content);
            if (!matcher.hasRules) return;
            const prefix = relative(base, root).split(sep).join('/');
            scopes.push({ matcher, prefix: prefix ? `${prefix}/` : '', strip: 0 });
        };
        await add(join(repoRoot, '.git', 'info', 'exclude'), repoRoot);
        for (const dir of outermostFirst) await add(join(dir, '.gitignore'), dir);
        return scopes;
    }

    #compile(source: string | readonly string[]): GitignoreMatcher {
        return GitignoreMatcher.compile(source, { ignoreCase: this.#ignoreCase });
    }
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
