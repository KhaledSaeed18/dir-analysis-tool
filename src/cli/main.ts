#!/usr/bin/env node
import { errorCode } from '../errors.ts';
import { processIO } from './io.ts';
import { run } from './program.ts';

// `dat --json | head` closes the pipe early; that is not an error.
for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: Error) => {
        if (errorCode(error) === 'EPIPE') process.exit(0);
        throw error;
    });
}

// The first Ctrl+C cancels gracefully (progress line cleared, exit code 130); a second one forces exit.
const controller = new AbortController();
process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(130);
    controller.abort();
});
process.on('SIGTERM', () => controller.abort());

process.exitCode = await run(process.argv.slice(2), processIO(controller.signal));
