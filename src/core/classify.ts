import { CATEGORIES, type Category, type SizeStat } from '../types.ts';

// prettier-ignore
const EXTENSIONS: Record<Exclude<Category, 'other'>, readonly string[]> = {
    code: [
        // JavaScript and TypeScript
        'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'astro',
        // Systems and compiled
        'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'm', 'mm', 'rs', 'go', 'zig', 'nim',
        'java', 'kt', 'kts', 'scala', 'groovy', 'gradle', 'cs', 'fs', 'vb', 'swift', 'dart',
        // Scripting
        'py', 'pyi', 'rb', 'php', 'pl', 'pm', 'lua', 'r', 'jl', 'ex', 'exs', 'erl', 'hrl',
        'clj', 'cljs', 'edn', 'hs', 'elm', 'ml', 'mli', 'sol',
        // Shell
        'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
        // Web and styles
        'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl', 'wasm', 'wat',
        // Config and schemas
        'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'xml',
        'xsd', 'graphql', 'gql', 'proto', 'prisma', 'tf', 'hcl', 'nix', 'cmake', 'mk',
        'dockerfile', 'lock', 'sql', 'map',
    ],
    documents: [
        'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'mdx', 'markdown', 'rst', 'adoc',
        'tex', 'org', 'epub', 'mobi', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'key',
        'pages', 'numbers',
    ],
    images: [
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp', 'tif', 'tiff',
        'ico', 'icns', 'svg', 'psd', 'ai', 'eps', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng',
        'xcf', 'sketch', 'fig', 'jxl',
    ],
    videos: [
        'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'ogv',
    ],
    audio: [
        'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'alac',
        'mid', 'midi',
    ],
    archives: [
        'zip', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'zst', 'lz4', 'lzma', '7z',
        'rar', 'jar', 'war', 'apk', 'aab', 'ipa', 'deb', 'rpm', 'dmg', 'iso', 'pkg', 'msi',
        'cab', 'whl', 'gem', 'nupkg', 'crx', 'vsix',
    ],
    fonts: ['ttf', 'otf', 'woff', 'woff2', 'eot', 'pfb', 'pfm'],
    data: [
        'csv', 'tsv', 'parquet', 'avro', 'orc', 'arrow', 'feather', 'db', 'sqlite', 'sqlite3',
        'mdb', 'accdb', 'npy', 'npz', 'h5', 'hdf5', 'pkl', 'pickle', 'ndjson', 'jsonl', 'bin',
        'dat', 'log', 'onnx', 'safetensors', 'pt', 'ckpt', 'gguf',
    ],
};

/** Well-known file names without a meaningful extension. Keys are lowercase. */
const FILE_NAMES: Record<string, Category> = {
    dockerfile: 'code',
    containerfile: 'code',
    makefile: 'code',
    gnumakefile: 'code',
    justfile: 'code',
    rakefile: 'code',
    gemfile: 'code',
    podfile: 'code',
    brewfile: 'code',
    procfile: 'code',
    vagrantfile: 'code',
    jenkinsfile: 'code',
    'cmakelists.txt': 'code',
    '.gitignore': 'code',
    '.gitattributes': 'code',
    '.gitmodules': 'code',
    '.dockerignore': 'code',
    '.npmrc': 'code',
    '.nvmrc': 'code',
    '.editorconfig': 'code',
    '.env': 'code',
    '.prettierrc': 'code',
    '.babelrc': 'code',
    license: 'documents',
    licence: 'documents',
    readme: 'documents',
    changelog: 'documents',
    authors: 'documents',
    contributors: 'documents',
    notice: 'documents',
};

const EXTENSION_TO_CATEGORY = new Map<string, Category>();
for (const category of CATEGORIES) {
    if (category === 'other') continue;
    for (const extension of EXTENSIONS[category]) {
        EXTENSION_TO_CATEGORY.set(`.${extension}`, category);
    }
}

/**
 * Extracts the lowercased extension (with the dot) from a file name.
 * Dotfiles such as `.env` have no extension; `archive.tar.gz` has `.gz`.
 */
export function extensionOf(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    if (dot <= 0 || dot === fileName.length - 1) return '';
    return fileName.slice(dot).toLowerCase();
}

/** Classifies a file by its well-known name first, then by extension. */
export function classify(fileName: string, extension: string = extensionOf(fileName)): Category {
    const byExtension = EXTENSION_TO_CATEGORY.get(extension);
    if (byExtension) return byExtension;
    const lower = fileName.toLowerCase();
    return FILE_NAMES[lower] ?? (lower.startsWith('.env.') ? 'code' : 'other');
}

/** A zeroed statistics record for every category. */
export function emptyTypeStats(): Record<Category, SizeStat> {
    return {
        code: { files: 0, bytes: 0 },
        documents: { files: 0, bytes: 0 },
        images: { files: 0, bytes: 0 },
        videos: { files: 0, bytes: 0 },
        audio: { files: 0, bytes: 0 },
        archives: { files: 0, bytes: 0 },
        fonts: { files: 0, bytes: 0 },
        data: { files: 0, bytes: 0 },
        other: { files: 0, bytes: 0 },
    };
}
