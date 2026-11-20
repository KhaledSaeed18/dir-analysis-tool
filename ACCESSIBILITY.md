# Accessibility

dir-analysis-tool should be usable by everyone who works in a terminal or reads its reports, including people who use a screen reader or a braille display, magnification, high-contrast or custom color schemes, or who can't tell some colors apart. This statement describes what it does for that today, where it falls short, and how to report a barrier.

## Commitment

- Every piece of information is in text. Color, bars and charts only repeat what the numbers and words already say.
- Every report is available in a structured form (JSON, Markdown, CSV), so you can read it with the tools that work best for you.
- Accessibility problems are bugs, and they are handled like any other bug.

## Terminal output

**Numbers carry the meaning.** Every bar in the type and extension breakdowns sits next to its size, its percentage and its file count, and every list item shows its size. The budgets heading counts failures in words (`Budgets  1 failed`), each rule is listed with its measured value, and the exit code says whether any failed; the README lists them under [Exit codes](https://github.com/KhaledSaeed18/dir-analysis-tool#exit-codes).

**Color is optional and off when it can't help.** Colors are used only when output is an interactive terminal. They are off when output is piped or written to a file, when `NO_COLOR` is set, when `TERM=dumb`, or with `--no-color`. The colors are the terminal's own standard ones, so your terminal theme decides how they look.

**Movement is limited and can be turned off.** On an interactive stderr, a scan draws one progress line with a spinner that rewrites itself until the report is ready; `--no-progress` or `-q` hides it, and it is never drawn in a pipe or in CI. `dat watch` clears the screen before each new report; `--no-clear` keeps earlier reports instead.

**No hidden characters.** File and folder names are escaped before they are printed, so control characters and bidirectional overrides in a name can't reach your terminal or your screen reader as noise or as commands. Error messages go to stderr.

## Other formats

- **Markdown** (`-f markdown`) gives every section as a real table, which a screen reader can move through by row and column, in a terminal or once rendered on GitHub.
- **JSON** (`--json`) and **CSV** (`--csv`) give the full data for your own tools or a spreadsheet.
- **HTML** (`--html`) is one self-contained file that declares its language, has a page title, a heading for the directory and one for each section, and lists data in tables with header cells. The path filter has a label, and the file type chart has a text alternative and sits next to a table with the same numbers. It follows your system's light or dark setting.

## Documentation

The README and the other Markdown files use real headings, lists and tables, so they can be navigated by structure. The README banner and badges have text alternatives. Command examples and sample output are text in code blocks, never images.

## Known limitations

- **Drawing characters.** The pretty report draws bars with block characters (`█`) and the size tree with box-drawing characters (`├─`). Some screen readers read them aloud as symbols. `-f markdown` gives the same data without them.
- **Aligned columns.** The pretty report pads columns with spaces to line numbers up. A screen reader reads the padding as a pause, and in a narrow terminal long paths may wrap.
- **The HTML report** has not had a formal audit against the Web Content Accessibility Guidelines. Its chart colors are fixed, and the chart itself conveys sizes only through color and arc length; the table next to it has the same data.
- **Budget marks.** Each budget rule is marked with `✔` or `✘` rather than a word, so a screen reader announces the symbol's name. The heading's count and `--json` (`budgets[].passed`) say the same in words.
- **Fixed color choice.** The terminal colors can't be changed. Set `NO_COLOR=1` to turn them off.

## Reporting a barrier

If something in dir-analysis-tool, its reports or its documentation is hard or impossible to use with the way you work, please [open an accessibility issue](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/new?template=accessibility.yml). Say what you were trying to do, what you use (for example a screen reader and its version, a terminal, a browser, a color scheme) and what got in the way. If you'd rather not report it in public, email [khaled18saeed@gmail.com](mailto:khaled18saeed@gmail.com).

Barriers are triaged like bugs, and a fix that changes output follows the same [stability promise](https://github.com/KhaledSaeed18/dir-analysis-tool#stability) as any other change: the wording and layout of the pretty, Markdown and HTML reports may change in a minor release, while the JSON report only gains fields.

This statement was last reviewed for dir-analysis-tool 3.4.1.
