export interface FileTypeClassification {
    images: number;
    videos: number;
    documents: number;
    audio: number;
    code: number;
    archives: number;
    other: number;
}

const FILE_TYPE_EXTENSIONS: Record<keyof Omit<FileTypeClassification, 'other'>, string[]> = {
    images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.ico', '.avif', '.heic'],
    videos: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.ogv'],
    documents: [
        '.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.doc', '.xls', '.ppt',
        '.rtf', '.odt', '.ods', '.odp', '.md', '.rst', '.tex', '.epub',
    ],
    audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus', '.aiff'],
    code: [
        '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
        '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.clj', '.dart',
        '.sh', '.bash', '.zsh', '.bat', '.ps1', '.sql', '.html', '.css', '.scss', '.sass', '.less',
        '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
        '.vue', '.svelte', '.astro', '.graphql', '.proto', '.dockerfile',
    ],
    archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst', '.lz4'],
};

const EXTENSION_MAP = new Map<string, keyof FileTypeClassification>();
for (const [type, exts] of Object.entries(FILE_TYPE_EXTENSIONS)) {
    for (const ext of exts) {
        EXTENSION_MAP.set(ext, type as keyof FileTypeClassification);
    }
}

export class FileClassifier {
    private counts: FileTypeClassification = {
        images: 0,
        videos: 0,
        documents: 0,
        audio: 0,
        code: 0,
        archives: 0,
        other: 0,
    };

    classifyFile(filename: string): void {
        const dot = filename.lastIndexOf('.');
        const ext = dot === -1 || dot === filename.length - 1 ? '' : filename.slice(dot).toLowerCase();
        const type = EXTENSION_MAP.get(ext) ?? 'other';
        this.counts[type]++;
    }

    getClassification(): FileTypeClassification {
        return { ...this.counts };
    }

    reset(): void {
        this.counts = { images: 0, videos: 0, documents: 0, audio: 0, code: 0, archives: 0, other: 0 };
    }
}
