export interface FileTypeClassification {
    images: number;
    videos: number;
    documents: number;
    audio: number;
    code: number;
    archives: number;
    other: number;
}

export interface FileTypeExtensions {
    images: string[];
    videos: string[];
    documents: string[];
    audio: string[];
    code: string[];
    archives: string[];
}

export const FILE_TYPE_EXTENSIONS: FileTypeExtensions = {
    images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.ico'],
    videos: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'],
    documents: ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.doc', '.xls', '.ppt', '.rtf', '.odt', '.ods', '.odp'],
    audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'],
    code: [
        '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
        '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.clj',
        '.sh', '.bat', '.ps1', '.sql', '.html', '.css', '.scss', '.sass', '.less',
        '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf'
    ],
    archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tar.gz', '.tar.bz2']
};

export class FileClassifier {
    private classification: FileTypeClassification = {
        images: 0,
        videos: 0,
        documents: 0,
        audio: 0,
        code: 0,
        archives: 0,
        other: 0
    };

    classifyFile(filename: string): void {
        const extension = this.getFileExtension(filename);
        const fileType = this.getFileType(extension);
        this.classification[fileType]++;
    }

    private getFileExtension(filename: string): string {
        const lastDotIndex = filename.lastIndexOf('.');
        if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) {
            return '';
        }
        return filename.substring(lastDotIndex).toLowerCase();
    }

    private getFileType(extension: string): keyof FileTypeClassification {
        for (const [type, extensions] of Object.entries(FILE_TYPE_EXTENSIONS)) {
            if (extensions.includes(extension)) {
                return type as keyof FileTypeClassification;
            }
        }
        return 'other';
    }

    getClassification(): FileTypeClassification {
        return { ...this.classification };
    }

    reset(): void {
        this.classification = {
            images: 0,
            videos: 0,
            documents: 0,
            audio: 0,
            code: 0,
            archives: 0,
            other: 0
        };
    }
}
