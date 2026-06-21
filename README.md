# Theta

Theta is a browser-first coding agent workspace.

The agent runs client-side in the browser. It sees the workspace as files and executes tools locally against a browser-backed filesystem. Server-side code is limited to LLM proxying, provider credential handling, and durable sync infrastructure.

## Architecture

- Browser agent runtime: `@earendil-works/pi-agent-core/base`
- LLM transport: thin server proxy using streamed responses
- Workspace model: file-oriented API exposed through `WorkspaceFs`
- Local execution: browser tools plus `just-bash`
- Local storage: IndexedDB or OPFS
- Multi-device sync: Electric backed by Postgres

## Core Rule

The agent sees files, not database rows.

Electric and Postgres are implementation details below the workspace filesystem layer. Agent tools operate on paths, file contents, directories, metadata, and command output.

## Initial Build Plan

1. Create the browser app shell.
2. Wire `pi-agent-core/base` with an LLM proxy.
3. Implement `WorkspaceFs` over local browser storage.
4. Add browser-native `read`, `write`, `edit`, `ls`, `grep`, and `find` tools.
5. Integrate `just-bash` against the same filesystem.
6. Add Electric/Postgres sync for workspaces and sessions.
7. Add conflict handling for multi-device edits.
