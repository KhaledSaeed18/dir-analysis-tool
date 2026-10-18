/**
 * An expected, user-facing failure (bad input, missing directory, invalid
 * config). The CLI prints its message without a stack trace.
 */
export class DatError extends Error {
    override readonly name = 'DatError';
    /** Optional hint printed after the message. */
    readonly hint: string | undefined;

    constructor(message: string, options: { hint?: string; cause?: unknown } = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.hint = options.hint;
    }
}

/** Thrown when an operation is cancelled through its `AbortSignal`. */
export class AbortError extends Error {
    override readonly name = 'AbortError';
    constructor(message = 'The operation was aborted') {
        super(message);
    }
}

/** The message of any thrown value. */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The Node.js error code (`ENOENT`, `EACCES`, …) of a thrown value, if it has one. */
export function errorCode(error: unknown): string | undefined {
    if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
    ) {
        return error.code;
    }
    return undefined;
}
