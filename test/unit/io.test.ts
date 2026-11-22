import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ignoreClosedPipe, isClosed, write } from '../../src/cli/io.ts';

/** A stream whose reader has gone away: every write fails with `code`. */
function failingStream(code: string): Writable & { writes: number } {
    const stream = new Writable({
        write(_chunk, _encoding, callback) {
            stream.writes++;
            callback(Object.assign(new Error(`write ${code}`), { code }));
        },
    }) as Writable & { writes: number };
    stream.writes = 0;
    return stream;
}

describe('write', () => {
    it('treats a closed pipe as the end of the output, not as an error', async () => {
        const stream = failingStream('EPIPE');
        ignoreClosedPipe(stream);
        expect(isClosed(stream)).toBe(false);
        await expect(write(stream, 'report')).resolves.toBeUndefined();
        expect(isClosed(stream)).toBe(true);
        // Later writes are dropped without touching the stream again.
        await expect(write(stream, 'more')).resolves.toBeUndefined();
        expect(stream.writes).toBe(1);
    });

    it('still rejects on other stream errors', async () => {
        const stream = failingStream('EIO');
        stream.on('error', () => {});
        await expect(write(stream, 'report')).rejects.toMatchObject({ code: 'EIO' });
        expect(isClosed(stream)).toBe(false);
    });

    it('rethrows stream errors that are not a closed pipe', () => {
        const stream = new Writable({ write: (_c, _e, cb) => cb() });
        ignoreClosedPipe(stream);
        expect(() =>
            stream.emit('error', Object.assign(new Error('boom'), { code: 'EIO' }))
        ).toThrow('boom');
        stream.emit('error', Object.assign(new Error('gone'), { code: 'EPIPE' }));
        expect(isClosed(stream)).toBe(true);
    });
});
