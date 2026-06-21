# Workspace Filesystem

`WorkspaceFs` is Theta's agent storage boundary. Agent tools, editors, file trees, and browser shell adapters must use this interface instead of reaching through to IndexedDB, OPFS, Electric, or Postgres details.

## Paths

Workspace paths use POSIX-style forward slashes and are rooted at `/`.

- `""`, `"."`, and `"/"` normalize to `/`.
- Relative paths normalize below root, so `src/index.ts` becomes `/src/index.ts`.
- Duplicate slashes and `.` segments are collapsed.
- `..`, backslashes, and NUL bytes are invalid.

Use `normalizeWorkspacePath(path)` before storing or comparing paths in adapter code.

## Data

`readFile` and `writeFile` handle bytes as `Uint8Array`. Implementations must copy input and output buffers so callers cannot mutate stored content accidentally.

`readTextFile` and `writeTextFile` are UTF-8 helpers. Invalid UTF-8 should surface as an error rather than silently replacing bytes.

## Writes

`WriteOptions` supports:

- `create`: allow creating a new file, default `true`
- `overwrite`: allow replacing an existing file, default `true`
- `expectedVersion`: reject stale writes with `WorkspaceConflictError`
- `mimeType` and `metadata`: optional file metadata

## Errors

Adapters should throw the exported `WorkspaceFsError` subclasses:

- `WorkspaceInvalidPathError`
- `WorkspaceNotFoundError`
- `WorkspaceAlreadyExistsError`
- `WorkspaceNotDirectoryError`
- `WorkspaceIsDirectoryError`
- `WorkspaceConflictError`
- `WorkspacePermissionError`

## Events

`watch(path, listener)` receives events for the watched path and its descendants. The returned function unsubscribes the listener.
