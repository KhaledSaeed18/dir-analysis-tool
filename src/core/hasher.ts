import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function hashFile(filePath: string): Promise<string> {
    const hash = createHash('md5');
    await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on('data', (chunk: Buffer) => hash.update(chunk));
        stream.on('end', resolve);
        stream.on('error', reject);
    });
    return hash.digest('hex');
}
