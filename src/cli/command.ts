/**
 * A small command-line parser covering the subset of the commander API this
 * CLI uses: subcommands with a default, grouped options, repeatable and
 * optional-value options, negatable `--no-x` flags, help, version, and
 * commander-style error messages with "did you mean" suggestions.
 */

/** Thrown for help, version, and usage errors; `exitCode` 0 means a normal exit. */
export class CommanderError extends Error {
    readonly exitCode: number;
    readonly code: string;

    constructor(exitCode: number, code: string, message: string) {
        super(message);
        this.name = 'CommanderError';
        this.exitCode = exitCode;
        this.code = code;
    }
}

/** Thrown by an option's `argParser` to reject a value with a message. */
export class InvalidArgumentError extends CommanderError {
    constructor(message: string) {
        super(1, 'commander.invalidArgument', message);
        this.name = 'InvalidArgumentError';
    }
}

export type OptionValueSource = 'cli' | 'default' | 'implied' | 'env';

/** Parameters are checked bivariantly so parsers may type `previous` precisely. */
type ArgParser = { bivariant(value: string, previous: unknown): unknown }['bivariant'];

export class Option {
    readonly flags: string;
    readonly description: string;
    readonly short: string | undefined;
    readonly long: string | undefined;
    /** `--no-x` style: sets `x` to false. */
    readonly negate: boolean;
    /** Takes a value: `<name>` (required) or `[name]` (optional). */
    readonly required: boolean;
    readonly optional: boolean;
    hidden: boolean = false;
    groupTitle: string | undefined;
    parseArg: ArgParser | undefined;
    argChoices: readonly string[] | undefined;

    constructor(flags: string, description = '') {
        this.flags = flags;
        this.description = description;
        let short: string | undefined;
        let long: string | undefined;
        for (const part of flags.split(/[ ,|]+/)) {
            if (part.startsWith('--')) long = part;
            else if (part.startsWith('-')) short = part;
        }
        this.short = short;
        this.long = long;
        this.negate = long?.startsWith('--no-') ?? false;
        this.required = flags.includes('<');
        this.optional = flags.includes('[');
    }

    /** Title of the section this option is listed under in help. */
    helpGroup(title: string): this {
        this.groupTitle = title;
        return this;
    }

    argParser(fn: ArgParser): this {
        this.parseArg = fn;
        return this;
    }

    /** Only these values are accepted. */
    choices(values: readonly string[]): this {
        this.argChoices = values;
        this.parseArg = (value: string) => {
            if (!values.includes(value)) {
                throw new InvalidArgumentError(`Allowed choices are ${values.join(', ')}.`);
            }
            return value;
        };
        return this;
    }

    hideHelp(hide = true): this {
        this.hidden = hide;
        return this;
    }

    /** `--large-files` -> `largeFiles`; `--no-color` -> `color`. */
    attributeName(): string {
        return camelCase(this.name());
    }

    name(): string {
        if (this.long) return this.long.replace(/^--(no-)?/, '');
        return this.short?.replace(/^-/, '') ?? '';
    }

    is(flag: string): boolean {
        return this.short === flag || this.long === flag;
    }
}

function camelCase(text: string): string {
    return text.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

interface Argument {
    name: string;
    required: boolean;
    description: string;
    defaultValue: unknown;
}

interface OutputConfiguration {
    writeOut?: (text: string) => void;
    writeErr?: (text: string) => void;
    outputError?: (text: string, write: (text: string) => void) => void;
}

type ActionHandler = { bivariant(...args: unknown[]): unknown }['bivariant'];

export class Command {
    readonly commands: Command[] = [];
    readonly options: Option[] = [];
    parent: Command | null = null;

    #name: string;
    #description = '';
    #version: string | undefined;
    #versionOption: Option | undefined;
    #helpOption: Option | undefined = new Option('-h, --help', 'display help for command');
    #helpCommand: { name: string; argument: string; description: string } | undefined;
    #defaultCommandName: string | undefined;
    #args: Argument[] = [];
    #action: ActionHandler | undefined;
    #afterHelp = '';
    #helpAfterError: string | boolean = false;
    #showSuggestion = true;
    #exitOverride = false;
    #output: Required<OutputConfiguration>;
    #values: Record<string, unknown> = {};
    #sources: Record<string, OptionValueSource> = {};

    constructor(name = '') {
        this.#name = name;
        this.#output = {
            writeOut: (text) => process.stdout.write(text),
            writeErr: (text) => process.stderr.write(text),
            outputError: (text, write) => write(text),
        };
    }

    name(): string {
        return this.#name;
    }

    description(text: string): this {
        this.#description = text;
        return this;
    }

    version(
        version: string,
        flags = '-V, --version',
        description = 'output the version number'
    ): this {
        this.#version = version;
        this.#versionOption = new Option(flags, description);
        return this;
    }

    helpOption(flags: string, description = 'display help for command'): this {
        this.#helpOption = new Option(flags, description);
        return this;
    }

    /** `helpCommand('help [command]', 'show help for a command')`. */
    helpCommand(nameAndArgs: string, description = 'display help for command'): this {
        const [name = 'help', ...rest] = nameAndArgs.trim().split(/\s+/);
        this.#helpCommand = { name, argument: rest.join(' '), description };
        return this;
    }

    configureOutput(configuration: OutputConfiguration): this {
        this.#output = { ...this.#output, ...configuration };
        return this;
    }

    /** Text (or `true` for the full help) printed after a usage error. */
    showHelpAfterError(text: string | boolean = true): this {
        this.#helpAfterError = text;
        return this;
    }

    showSuggestionAfterError(show = true): this {
        this.#showSuggestion = show;
        return this;
    }

    /** Throw a `CommanderError` instead of calling `process.exit`. */
    exitOverride(): this {
        this.#exitOverride = true;
        return this;
    }

    command(name: string, options: { isDefault?: boolean } = {}): Command {
        const sub = new Command(name);
        sub.parent = this;
        sub.#output = this.#output;
        sub.#helpAfterError = this.#helpAfterError;
        sub.#showSuggestion = this.#showSuggestion;
        sub.#exitOverride = this.#exitOverride;
        if (this.#helpOption) sub.#helpOption = this.#helpOption;
        this.commands.push(sub);
        if (options.isDefault) this.#defaultCommandName = name;
        return sub;
    }

    argument(spec: string, description = '', defaultValue?: unknown): this {
        const required = spec.startsWith('<');
        this.#args.push({
            name: spec.slice(1, -1),
            required,
            description,
            defaultValue,
        });
        return this;
    }

    addOption(option: Option): this {
        this.options.push(option);
        // A lone `--no-x` means x is on unless turned off, as in commander.
        if (option.negate && option.long) {
            const positive = option.long.replace(/^--no-/, '--');
            if (!this.options.some((o) => o.long === positive)) {
                this.setOptionValueWithSource(option.attributeName(), true, 'default');
            }
        }
        return this;
    }

    action(fn: ActionHandler): this {
        this.#action = fn;
        return this;
    }

    addHelpText(position: 'after' | 'before' | 'afterAll' | 'beforeAll', text: string): this {
        if (position === 'after' || position === 'afterAll') this.#afterHelp += text;
        return this;
    }

    opts(): Record<string, unknown> {
        return { ...this.#values };
    }

    getOptionValue(key: string): unknown {
        return this.#values[key];
    }

    getOptionValueSource(key: string): OptionValueSource | undefined {
        return this.#sources[key];
    }

    setOptionValueWithSource(key: string, value: unknown, source: OptionValueSource): this {
        this.#values[key] = value;
        this.#sources[key] = source;
        return this;
    }

    async parseAsync(
        argv: readonly string[],
        options: { from?: 'user' | 'node' } = {}
    ): Promise<this> {
        const args = options.from === 'node' ? argv.slice(2) : [...argv];
        await this.#parseCommand(args);
        return this;
    }

    // ----- parsing ---------------------------------------------------------

    async #parseCommand(args: string[]): Promise<void> {
        if (this.commands.length > 0 || this.#helpCommand) {
            await this.#dispatch(args);
            return;
        }
        const operands = this.#parseOptions(args);
        this.#processArguments(operands);
        if (this.#action) {
            await this.#action(...this.#positionals, this.opts(), this);
        }
    }

    /** Root level: route to an explicit subcommand, the help command, or the default command. */
    async #dispatch(args: string[]): Promise<void> {
        const rest: string[] = [];
        let first: string | undefined;
        let firstIndex = -1;
        for (let i = 0; i < args.length; i++) {
            const arg = args[i]!;
            if (arg === '--') {
                rest.push(...args.slice(i));
                break;
            }
            if (first === undefined && arg.startsWith('-') && arg.length > 1) {
                if (this.#versionOption?.is(arg)) {
                    this.#output.writeOut(`${this.#version ?? ''}\n`);
                    this.#exit(0, 'commander.version', this.#version ?? '');
                }
            }
            if (first === undefined && !arg.startsWith('-')) {
                first = arg;
                firstIndex = rest.length;
            }
            rest.push(arg);
        }

        if (first !== undefined) {
            const sub = this.commands.find((c) => c.#name === first);
            if (sub) {
                rest.splice(firstIndex, 1);
                await sub.#parseCommand(rest);
                return;
            }
            if (this.#helpCommand && first === this.#helpCommand.name) {
                const target = rest[firstIndex + 1];
                if (target === undefined) this.outputHelp();
                else {
                    const command = this.commands.find((c) => c.#name === target);
                    if (!command) {
                        this.outputHelp({ error: true });
                        this.#exit(1, 'commander.help', '(outputHelp)');
                    }
                    command.outputHelp();
                }
                this.#exit(0, 'commander.helpDisplayed', '(outputHelp)');
            }
        }

        // Help for the default command is answered by the root, as in commander.
        this.#outputHelpIfRequested(rest);
        if (this.#defaultCommandName) {
            const sub = this.commands.find((c) => c.#name === this.#defaultCommandName)!;
            await sub.#parseCommand(rest);
            return;
        }
        if (rest.length === 0) {
            this.outputHelp({ error: true });
            this.#exit(1, 'commander.help', '(outputHelp)');
        }
        const operands = this.#parseOptions(rest);
        if (operands.length > 0) {
            this.error(`error: unknown command '${operands[0]}'`, 'commander.unknownCommand');
        }
    }

    #outputHelpIfRequested(args: readonly string[]): void {
        if (!this.#helpOption) return;
        for (const arg of args) {
            if (arg === '--') return;
            if (this.#helpOption.is(arg)) {
                this.outputHelp();
                this.#exit(0, 'commander.helpDisplayed', '(outputHelp)');
            }
        }
    }

    #findOption(flag: string): Option | undefined {
        return this.options.find((o) => o.is(flag));
    }

    /** Consumes options and returns the positional operands. */
    #parseOptions(args: readonly string[]): string[] {
        const operands: string[] = [];
        const queue = [...args];
        this.#outputHelpIfRequested(queue);
        while (queue.length > 0) {
            const arg = queue.shift()!;
            if (arg === '--') {
                operands.push(...queue);
                break;
            }
            if (!arg.startsWith('-') || arg === '-') {
                operands.push(arg);
                continue;
            }

            // --flag=value
            if (arg.startsWith('--')) {
                const eq = arg.indexOf('=');
                if (eq !== -1) {
                    const flag = arg.slice(0, eq);
                    const option = this.#findOption(flag);
                    if (!option || !(option.required || option.optional)) this.unknownOption(arg);
                    this.#applyOption(option, arg.slice(eq + 1));
                    continue;
                }
                const option = this.#findOption(arg);
                if (!option) this.unknownOption(arg);
                this.#takeValue(option, queue);
                continue;
            }

            // -o, -ovalue, -adx
            const option = this.#findOption(arg.slice(0, 2));
            if (!option) this.unknownOption(arg);
            if (arg.length > 2) {
                const attached = arg.slice(2);
                if (option.required || option.optional) {
                    this.#applyOption(option, attached);
                } else {
                    this.#applyOption(option, null);
                    queue.unshift(`-${attached}`);
                }
                continue;
            }
            this.#takeValue(option, queue);
        }
        return operands;
    }

    #takeValue(option: Option, queue: string[]): void {
        if (option.required) {
            const value = queue.shift();
            if (value === undefined) {
                this.error(
                    `error: option '${option.flags}' argument missing`,
                    'commander.optionMissingArgument'
                );
            }
            this.#applyOption(option, value);
        } else if (option.optional) {
            const next = queue[0];
            if (next !== undefined && !(next.length > 1 && next.startsWith('-'))) {
                queue.shift();
                this.#applyOption(option, next);
            } else {
                this.#applyOption(option, null);
            }
        } else {
            this.#applyOption(option, null);
        }
    }

    /** `value` is null when the flag was given without a value. */
    #applyOption(option: Option, value: string | null): void {
        const key = option.attributeName();
        let result: unknown;
        if (value !== null && option.parseArg) {
            const previous = this.#values[key];
            try {
                result = option.parseArg(value, previous);
            } catch (error) {
                if (error instanceof InvalidArgumentError) {
                    this.error(
                        `error: option '${option.flags}' argument '${value}' is invalid. ${error.message}`,
                        'commander.invalidArgument'
                    );
                }
                throw error;
            }
        } else if (value !== null) {
            result = value;
        } else if (option.negate) {
            result = false;
        } else {
            result = true;
        }
        this.setOptionValueWithSource(key, result, 'cli');
    }

    #positionals: unknown[] = [];

    #processArguments(operands: string[]): void {
        const positionals: unknown[] = [];
        for (const [index, arg] of this.#args.entries()) {
            const value = operands[index];
            if (value === undefined) {
                if (arg.required) {
                    this.error(
                        `error: missing required argument '${arg.name}'`,
                        'commander.missingArgument'
                    );
                }
                positionals.push(arg.defaultValue);
            } else {
                positionals.push(value);
            }
        }
        if (operands.length > this.#args.length) {
            const expected = this.#args.length;
            const list = operands.length > 0 ? `: ${operands.join(', ')}` : '';
            this.error(
                `error: too many arguments${this.parent ? ` for '${this.#name}'` : ''}. Expected ${expected} argument${expected === 1 ? '' : 's'} but got ${operands.length}${list}.`,
                'commander.excessArguments'
            );
        }
        this.#positionals = positionals;
    }

    // ----- errors ----------------------------------------------------------

    unknownOption(flag: string): never {
        let message = `error: unknown option '${flag}'`;
        if (this.#showSuggestion && flag.startsWith('--')) {
            const candidates: string[] = [];
            for (const command of this.#ancestors()) {
                for (const option of command.#visibleOptions()) {
                    if (option.long) candidates.push(option.long);
                }
            }
            const suggestion = suggestSimilar(flag, candidates);
            if (suggestion) message += `\n(Did you mean ${suggestion}?)`;
        }
        return this.error(message, 'commander.unknownOption');
    }

    /** Prints a usage error (plus the help-after-error text) and exits with code 1. */
    error(message: string, code = 'commander.error'): never {
        this.#output.outputError(`${message}\n`, this.#output.writeErr);
        if (typeof this.#helpAfterError === 'string') {
            this.#output.writeErr(`${this.#helpAfterError}\n`);
        } else if (this.#helpAfterError) {
            this.#output.writeErr('\n');
            this.outputHelp({ error: true });
        }
        return this.#exit(1, code, message);
    }

    #exit(exitCode: number, code: string, message: string): never {
        if (this.#exitOverride) throw new CommanderError(exitCode, code, message);
        process.exit(exitCode);
    }

    // ----- help ------------------------------------------------------------

    #visibleOptions(): Option[] {
        const visible = this.options.filter((o) => !o.hidden);
        if (this.#versionOption) visible.push(this.#versionOption);
        if (this.#helpOption) visible.push(this.#helpOption);
        return visible;
    }

    /** This command and its parents, nearest first. */
    #ancestors(): Command[] {
        return this.parent ? [this, ...this.parent.#ancestors()] : [this];
    }

    #fullName(): string {
        return this.parent ? `${this.parent.#fullName()} ${this.#name}` : this.#name;
    }

    #argsUsage(): string {
        return this.#args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ');
    }

    #commandTerm(): string {
        const parts = [this.#name];
        if (this.options.length > 0) parts.push('[options]');
        const args = this.#argsUsage();
        if (args) parts.push(args);
        return parts.join(' ');
    }

    outputHelp(options: { error?: boolean } = {}): void {
        const write = options.error ? this.#output.writeErr : this.#output.writeOut;
        const stream = options.error ? process.stderr : process.stdout;
        const width = stream.isTTY ? stream.columns : undefined;
        write(this.helpInformation(width));
        if (this.#afterHelp) write(`${this.#afterHelp}\n`);
    }

    helpInformation(helpWidth = 80): string {
        const usage = ['[options]'];
        if (this.commands.length > 0 || this.#helpCommand) usage.push('[command]');
        const args = this.#argsUsage();
        if (args) usage.push(args);
        const lines: string[] = [`Usage: ${this.#fullName()} ${usage.join(' ')}`, ''];
        if (this.#description) lines.push(this.#description, '');

        type Item = [term: string, description: string];
        const argumentItems: Item[] = this.#args.map((a) => [
            a.name,
            a.description +
                (a.defaultValue !== undefined
                    ? ` (default: ${JSON.stringify(a.defaultValue)})`
                    : ''),
        ]);
        const groups = new Map<string, Item[]>();
        for (const option of this.#visibleOptions()) {
            const title = option.groupTitle ?? 'Options:';
            const items = groups.get(title) ?? [];
            let description = option.description;
            if (option.argChoices) {
                description += ` (choices: ${option.argChoices.map((c) => JSON.stringify(c)).join(', ')})`;
            }
            items.push([option.flags, description]);
            groups.set(title, items);
        }
        const commandItems: Item[] = this.commands.map((c) => [c.#commandTerm(), c.#description]);
        if (this.#helpCommand) {
            const { name, argument, description } = this.#helpCommand;
            commandItems.push([argument ? `${name} ${argument}` : name, description]);
        }

        const all = [...argumentItems, ...[...groups.values()].flat(), ...commandItems];
        const termWidth = Math.max(0, ...all.map(([term]) => term.length));
        const section = (title: string, items: Item[]): void => {
            if (items.length === 0) return;
            lines.push(title);
            for (const [term, description] of items) {
                lines.push(formatItem(term, termWidth, description, helpWidth));
            }
            lines.push('');
        };
        section('Arguments:', argumentItems);
        for (const [title, items] of groups) section(title, items);
        section('Commands:', commandItems);
        if (lines.at(-1) === '') lines.pop();
        return `${lines.join('\n')}\n`;
    }
}

function formatItem(
    term: string,
    termWidth: number,
    description: string,
    helpWidth: number
): string {
    const indent = 2;
    const spacer = 2;
    if (!description) return `${' '.repeat(indent)}${term}`;
    const remaining = helpWidth - termWidth - spacer - indent;
    const text =
        remaining < 40 || description.includes('\n') ? description : wrap(description, remaining);
    const continuation = `\n${' '.repeat(indent + termWidth + spacer)}`;
    return `${' '.repeat(indent)}${term.padEnd(termWidth)}${' '.repeat(spacer)}${text.replaceAll('\n', continuation)}`;
}

function wrap(text: string, width: number): string {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
        if (line && line.length + 1 + word.length > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines.join('\n');
}

// ----- suggestions (optimal string alignment distance, as in commander) ------

const MAX_DISTANCE = 3;

function editDistance(a: string, b: string): number {
    if (Math.abs(a.length - b.length) > MAX_DISTANCE) return Math.max(a.length, b.length);
    const d: number[][] = [];
    for (let i = 0; i <= a.length; i++) d.push([i]);
    for (let j = 0; j <= b.length; j++) d[0]![j] = j;
    for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                best = Math.min(best, d[i - 2]![j - 2]! + 1);
            }
            d[i]![j] = best;
        }
    }
    return d[a.length]![b.length]!;
}

/** Closest candidate(s) to `word`, or '' when nothing is similar enough. */
export function suggestSimilar(word: string, candidates: readonly string[]): string {
    if (candidates.length === 0) return '';
    const unique = [...new Set(candidates)];
    const stripped = word.startsWith('--');
    const needle = stripped ? word.slice(2) : word;
    const pool = stripped ? unique.map((c) => c.slice(2)) : unique;

    let similar: string[] = [];
    let bestDistance = MAX_DISTANCE;
    for (const candidate of pool) {
        if (candidate.length <= 1) continue;
        const distance = editDistance(needle, candidate);
        const length = Math.max(needle.length, candidate.length);
        const similarity = (length - distance) / length;
        if (similarity > 0.4) {
            if (distance < bestDistance) {
                bestDistance = distance;
                similar = [candidate];
            } else if (distance === bestDistance) {
                similar.push(candidate);
            }
        }
    }
    similar.sort((a, b) => a.localeCompare(b));
    if (stripped) similar = similar.map((c) => `--${c}`);
    if (similar.length > 1) return `one of ${similar.join(', ')}`;
    return similar[0] ?? '';
}
