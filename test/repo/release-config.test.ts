import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The release runs only on main, after merging, so a dependency update that
// breaks it (a changelog preset the writer can't render, say) would pass CI
// and fail the next release. This runs the real release plugins with the real
// .releaserc.json, so such an update fails here instead.

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

type Plugin = string | [string, Record<string, unknown>];
type Commit = { hash: string; message: string; subject: string; body: string };
type Context = Record<string, unknown>;

const releaserc = JSON.parse(readFileSync(`${ROOT}/.releaserc.json`, 'utf8')) as {
    plugins: Plugin[];
};

function pluginConfig(name: string): Record<string, unknown> {
    const entry = releaserc.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
    return Array.isArray(entry) ? entry[1] : {};
}

// The plugins ship no types; a computed specifier keeps TypeScript from asking.
async function load<T>(name: string): Promise<T> {
    return (await import(name)) as T;
}

const quiet = { log() {}, success() {}, warn() {}, error() {} };

function context(messages: string[]): Context {
    const commits: Commit[] = messages.map((message, i) => ({
        hash: String(i).padStart(40, 'a'),
        message,
        subject: message.split('\n')[0] ?? '',
        body: message.split('\n').slice(2).join('\n'),
    }));
    return {
        cwd: ROOT,
        env: {},
        logger: quiet,
        commits,
        options: { repositoryUrl: 'https://github.com/KhaledSaeed18/dir-analysis-tool.git' },
        lastRelease: { gitTag: 'v3.0.0', version: '3.0.0', gitHead: 'b'.repeat(40) },
        nextRelease: { gitTag: 'v3.1.0', version: '3.1.0', type: 'minor' },
    };
}

async function releaseType(messages: string[]): Promise<string | null> {
    const name = '@semantic-release/commit-analyzer';
    const { analyzeCommits } = await load<{
        analyzeCommits: (config: unknown, context: Context) => Promise<string | null>;
    }>(name);
    return analyzeCommits(pluginConfig(name), context(messages));
}

describe('the release configuration', () => {
    it('never releases dependency updates, CI or other housekeeping', async () => {
        expect(await releaseType(['build(deps-dev): bump the dev-dependencies group'])).toBeNull();
        expect(await releaseType(['ci(deps): bump the github-actions group'])).toBeNull();
        expect(await releaseType(['docs: reword', 'test: cover', 'refactor: tidy'])).toBeNull();
    });

    it('releases a patch, minor or major from fix, docs(readme), perf, feat and breaking changes', async () => {
        expect(await releaseType(['fix(core): a'])).toBe('patch');
        expect(await releaseType(['docs(readme): b'])).toBe('patch');
        expect(await releaseType(['perf(core): f'])).toBe('patch');
        expect(await releaseType(['feat(cli): c'])).toBe('minor');
        expect(await releaseType(['feat!: d\n\nBREAKING CHANGE: e'])).toBe('major');
    });

    it('renders release notes with the changelog preset', async () => {
        const name = '@semantic-release/release-notes-generator';
        const { generateNotes } = await load<{
            generateNotes: (config: unknown, context: Context) => Promise<string>;
        }>(name);
        const notes = await generateNotes(
            pluginConfig(name),
            context(['feat(cli): add a thing', 'fix: mend a bug', 'build(deps-dev): bump x'])
        );
        expect(notes).toContain('### Features');
        expect(notes).toContain('**cli:** add a thing');
        expect(notes).toContain('### Bug Fixes');
        expect(notes).not.toContain('bump x');
    });
});
