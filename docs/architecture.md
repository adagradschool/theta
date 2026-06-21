# Architecture

Theta is a browser-first coding agent workspace. The agent runtime, tools, shell layer, and workspace state run client-side. Server-side code is limited to LLM proxying, provider credential handling, and durable sync infrastructure.

## Core Boundary

The agent sees a filesystem, not a database.

Electric and Postgres are implementation details below a browser workspace filesystem layer. Agent tools operate on paths, file contents, directories, metadata, and command output.

```text
Browser UI
  -> pi-agent-core Agent
  -> browser tools and just-bash-lite
  -> WorkspaceFs
  -> IndexedDB or OPFS local cache
  -> Electric sync
  -> Postgres

Agent
  -> LLM proxy
  -> LLM provider
```

Only LLM calls cross the agent boundary to the server. Tool calls return to the browser and execute locally.

## Package Strategy

Theta should use Pi as an engine, not as the app shell.

Use directly:

- `@earendil-works/pi-agent-core/base` for agent state, tool calling, streaming events, queues, and lifecycle.
- `@earendil-works/pi-ai/base` for model and provider-neutral types/utilities when needed.
- `streamProxy` or an equivalent thin proxy contract for server-side provider calls.

Do not import `@earendil-works/pi-coding-agent` as a browser runtime dependency. It is a Node CLI product with terminal, filesystem, process, auth, package-manager, and local-resource assumptions.

Instead, treat `pi-coding-agent` as a reference implementation and reimplement the browser-safe concepts Theta needs.

## Reimplemented Pi Concepts

Reimplement these concepts with browser storage and browser execution:

- Session management, backed by IndexedDB/OPFS and Electric instead of JSONL files.
- Compaction orchestration, using the browser session store and LLM proxy.
- Custom message conversion, including equivalents of Pi's `convertToLlm` behavior.
- Tool definitions for `read`, `write`, `edit`, `ls`, `grep`, `find`, and `bash`.
- Model and thinking settings, scoped to the web app and user workspace.
- Slash-command concepts if they remain useful in the web UI.

Skip or defer these Pi CLI concepts:

- Terminal UI.
- CLI and RPC process modes.
- File-based auth storage.
- npm/git package-manager extension loading.
- Host shell execution.
- Filesystem resource loading from the local machine.

## Workspace Filesystem

All tools should depend on a narrow filesystem interface.

```ts
interface WorkspaceFs {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, options?: WriteOptions): Promise<void>;
  delete(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStat>;
  watch(path: string, listener: (event: FsEvent) => void): () => void;
}
```

`WorkspaceFs` is the boundary between agent behavior and storage/sync implementation. The editor, file tree, browser tools, and browser shell should all use the same interface.

## Tool Mapping

- `read`: `WorkspaceFs.readFile`
- `write`: `WorkspaceFs.writeFile`
- `edit`: read, patch, compare expected version, write
- `ls`: `WorkspaceFs.readdir`
- `grep`: browser-side search over the local workspace cache
- `find`: browser-side path index query
- `bash`: vendored `just-bash-lite` wired to the same `WorkspaceFs`

`just-bash-lite` is the browser shell execution layer. It is not a host shell and should not be treated as one. Theta vendors the small command surface it needs instead of depending on the full upstream `just-bash` package.

## Sync Model

Local-first flow:

1. Browser opens a workspace.
2. Electric syncs workspace and session shapes into local cache.
3. UI and tools read from `WorkspaceFs`.
4. Agent calls tools.
5. Tool writes update local storage first.
6. Local changes sync through Electric to Postgres.
7. Other devices receive changes and update their local cache.

Suggested durable records:

```text
workspaces
  id
  owner_id
  name
  created_at
  updated_at

workspace_files
  workspace_id
  path
  kind
  content
  content_hash
  mode
  mtime
  version
  deleted_at

workspace_file_ops
  id
  workspace_id
  path
  op_type
  base_version
  payload
  created_by_device_id
  created_at

sessions
  id
  workspace_id
  title
  active_leaf_id
  created_at
  updated_at

session_entries
  id
  session_id
  parent_id
  type
  payload
  created_at
```

## Conflict Policy

Use optimistic writes with expected versions.

If a write is based on a stale version:

- Merge simple non-overlapping text edits when safe.
- Otherwise create explicit conflict artifacts or records.
- Present conflicts as normal workspace files so the user or agent can resolve them.

The system should not silently overwrite remote edits.

## Build Order

1. Browser app shell using `pi-agent-core/base`.
2. Thin LLM proxy.
3. `WorkspaceFs` over IndexedDB or OPFS.
4. Browser-native file tools.
5. `just-bash-lite` integration against `WorkspaceFs`.
6. Browser session manager.
7. Compaction.
8. Electric/Postgres sync.
9. Conflict handling and multi-device UI states.
