# Theta

<p align="center">
  <img src="https://raw.githubusercontent.com/adagradschool/theta/main/assets/theta-logo.png" alt="Theta Renaissance crest" width="360">
</p>

Theta is a browser-first agent runtime.

The goal is simple: run the agent inside the browser, use the browser as the
sandbox, and give the agent a real workspace filesystem to operate on. The
backend should not be the agent runtime. It should only handle the small set of
responsibilities that genuinely need a server, such as provider credential
handling and cross-device sync.

## Why Browser-First

Most coding-agent stacks push execution into remote sandboxes such as Modal,
Daytona, Bedrock AgentCore, Vercel Sandbox, or a bespoke container fleet. That
can be powerful, but it increases architecture complexity, adds ongoing
operational cost, introduces extra latency, and makes durable user-owned state
harder to maintain.

Theta moves that boundary into the browser:

- The agent loop runs client-side.
- Tools execute against browser-owned workspace state.
- The browser security model is the sandbox.
- Workspace state is files, not database rows.
- Local persistence survives reloads and browser restarts.
- The backend can be thin, stateless, or eliminated entirely in BYOK mode.

This makes the package intentionally slim. Theta is not a hosted agent platform.
It is the browser runtime layer: agent state, tool calling, messages, sessions,
filesystem adapters, browser tools, and sync primitives.

Theta uses [Pi](https://github.com/earendil-works/pi) as its core agent engine.
The browser-facing package composes the
[Pi coding agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
loop and model/tool abstractions with Theta's filesystem, sessions, browser
tools, local persistence, and sync boundaries.

## Filesystem as the Agent Interface

The agent should work with files because files are the right ergonomic boundary
for agents, developers, and users:

- `read`, `write`, `edit`, `ls`, `grep`, and `find` operate on paths.
- Sessions and tool traces can be rendered as application state.
- Files can be inspected, edited, synced, versioned, and repaired.
- Storage implementation details stay below `WorkspaceFs`.

Theta uses
[OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
as the durable browser storage substrate. File bytes are stored as
content-addressed blobs in OPFS, while metadata, manifests, versions, and sync
state live in PGlite.

## Browser Execution

Theta vendors a small
[`just-bash`](https://github.com/vercel-labs/just-bash)-style shell layer for
browser execution. It is a browser-local command environment backed by the same
`WorkspaceFs` that the agent tools use.

That means commands mutate the same workspace the UI and tools see, while still
remaining inside the browser sandbox.

Today, this includes the useful shell, file, and text commands needed by the
agent.
Future runtimes can add richer browser-side execution, such as Python shipped as
WASM, without changing the core agent/filesystem boundary.

## Backend Responsibility

Theta is designed to shrink backend responsibility.

The default server-side surface can be as small as:

- a thin LLM proxy for provider calls,
- app-level auth/header injection,
- durable sync endpoints,
- blob storage for synced content.

If the product is BYOK, even the LLM proxy can disappear: the browser can call
the provider directly with a user-supplied key. That is not always the right
product choice, but Theta supports it because the runtime itself does not depend
on a server.

The important point: the backend does not need to host the agent runtime or
manage remote sandboxes just to give users an agentic workspace.

## Multi-Device Sync

Local-first does not mean single-device.

Theta's sync direction is:

- PGlite in the browser for local metadata and control-plane state.
- Electric SQL for multi-device metadata sync through Postgres.
- OPFS for local content-addressed blobs.
- R2 or another inexpensive object store for synced content blobs.

In this model, Electric/Postgres syncs workspace metadata, manifests, versions,
sessions, branches, and mutation state. R2 syncs the blob payloads addressed by
content hash. The agent continues to see a normal filesystem either way.

## Package Shape

The library is organized by runtime boundary:

- `core`: agent, workspace, events, messages, tools, compaction.
- `fs`: filesystem contracts and in-memory filesystem.
- `local-storage`: PGlite metadata, OPFS blobs, mutation queue, local FS adapter.
- `browser-tools`: browser-native file tools.
- `bash-tool` and `just-bash-lite`: browser-local shell execution.
- `sessions`: session manager and persistent stores.
- `sync`: blob sync, Electric sync, workspace manifest sync.
- `llm`: proxy request and streaming contract.
- `ui`: headless UI state helpers and optional React hooks.

The public entrypoints stay small:

- `@adagradschool/theta`
- `@adagradschool/theta/browser`
- `@adagradschool/theta/server`
- `@adagradschool/theta/react`

## Core Rule

The agent sees files.

PGlite, OPFS, Electric, Postgres, and R2 are implementation details below the
filesystem abstraction. The application can present polished productivity UI on
top, but the runtime boundary remains a minimal self-modifying agent working
carefully over a durable browser filesystem.
