#!/usr/bin/env node
import { ignoreClosedPipe, processIO } from './io.ts';
import { run } from './program.ts';

// `dat --json | head` closes the pipe early. That is not an error, and it must not change the exit
// code either: a failed budget still exits 2, so a CI step that pipes the report still fails.
ignoreClosedPipe(process.stdout);
ignoreClosedPipe(process.stderr);

// The first Ctrl+C cancels gracefully (progress line cleared, exit code 130); a second one forces exit.
const controller = new AbortController();
process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(130);
    controller.abort();
});
process.on('SIGTERM', () => controller.abort());

process.exitCode = await run(process.argv.slice(2), processIO(controller.signal));
