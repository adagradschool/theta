# Development Rules

## Project Direction

- Theta is a browser-first coding agent workspace.
- The agent runtime should run client-side.
- Only LLM provider calls, credential handling, and durable sync infrastructure should run server-side.
- The agent must interact with the workspace as files, not database records.
- Prefer small, explicit interfaces around runtime boundaries.

## Architecture Boundaries

- Use `@earendil-works/pi-agent-core/base` for agent state and tool calling.
- Use `@earendil-works/pi-ai/base` only when direct model utilities are needed.
- Route LLM calls through a thin server proxy; do not expose provider credentials to the browser.
- Implement tools against a `WorkspaceFs` abstraction.
- Keep Electric/Postgres details below the filesystem abstraction.
- Treat `just-bash` as the browser shell execution layer, not as a host shell.

## Code Quality

- Keep answers and comments concise.
- Do not use `any` unless there is no reasonable typed alternative.
- Avoid broad abstractions before there are at least two real call sites.
- Prefer composition over forking upstream Pi packages.
- Do not import Node-only modules into browser runtime code.
- Keep server code thin and explicit.

## Git

- Do not commit unless explicitly asked.
- Stage explicit paths only.
- Do not use destructive git commands.
