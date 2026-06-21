# just-bash-lite

Theta vendors a small browser shell runtime instead of depending on the full `just-bash` npm package. The goal is to keep the core browser package free of SQLite, Python, QuickJS, network, and archive-processing dependency weight while still giving the agent a useful bash-like tool.

The supported shell surface is deliberately narrow:

- command sequencing with `;`, `&&`, and `||`
- pipelines with `|`
- stdin/stdout redirection with `<`, `>`, and `>>`
- single and double quoted strings
- environment expansion with `$NAME` and `${NAME}`
- per-command `cwd`, `env`, timeout, abort, stdout, stderr, and exit code reporting
- custom commands registered through `customCommands`
- filesystem commands: `cat`, `cp`, `ls`, `mkdir`, `mv`, `rm`, `touch`, `basename`, `dirname`
- text/search commands: `find`, `grep`, `rg`, `head`, `tail`, `sort`, `wc`
- core commands: `cd`, `echo`, `env`, `export`, `false`, `printenv`, `printf`, `pwd`, `sleep`, `true`, `which`

Unsupported shell features should fail clearly rather than silently pretending to work. Add commands only when there is a real agent workflow that needs them.
