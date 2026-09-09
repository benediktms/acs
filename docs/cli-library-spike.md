# CLI library spike

Checked 2026-09-09 with Bun 1.3.14 compiled probes. Commander 15.0.0 is the
selected CLI library: it generated root, group, and three-level help; exited 0
for `-h`/`--help`; enforced required arguments, choices, required/conflicting
options, typed parsers, and repeat collectors; supported sync and async actions
through `parseAsync`; exited 1 for usage errors; and preserved
`codex run -- --help --model gpt-5` passthrough. It has zero runtime
dependencies, an npm unpacked size of 207,368 bytes, and added 66,048 bytes to
the compiled probe. Commander 15.0.0 released 2026-05-29; its repository was
pushed 2026-09-01.

Yargs 18.1.0 passed invalid numeric `nope` to its handler as `NaN` with exit 0,
has six direct dependencies, needs `@types`, and added 231,168 compiled bytes.
Citty 0.2.2 kept only the last repeated option, consumed help after literal
`--`, dropped ancestors from deep help, and added 16,512 bytes. Clipanion was
pre-screened: stable 3.2.1 dates to 2023 and latest 4.0.0-rc.4 dates to 2024.
