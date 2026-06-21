# Local Browser Storage

Theta uses a hybrid local storage strategy:

- **PGlite** is the browser control plane database.
- **OPFS** stores materialized content-addressed file bytes.
- **Postgres/Electric** syncs durable metadata across devices.

Raw IndexedDB is not a Theta storage abstraction. If a browser persistence layer uses IndexedDB internally, that stays below PGlite or another adapter boundary.

## PGlite Control Plane

PGlite stores synced, queryable metadata:

- workspace paths
- directory index fields
- file versions
- content hashes
- sizes and MIME types
- migration state
- future Electric sync cursors, conflict records, and pending operations

The production adapter is `createPGliteWorkspaceMetadataStore(pg)`. It runs Theta's SQL migrations and uses transactions for compare-and-set metadata writes.

## OPFS File Bytes

OPFS stores file bytes by content hash through `createOpfsBlobCache()`. OPFS is a local materialization cache, not the cross-device source of truth.

If OPFS content is missing, synced PGlite/Electric metadata can identify the missing hash and restore it from the remote blob store.

## WorkspaceFs

`createLocalWorkspaceFs()` composes:

- a `PGliteWorkspaceMetadataStore`
- a `BlobCache`

This keeps agent tools on the `WorkspaceFs` interface while allowing the storage implementation to use PGlite, OPFS, and Electric below that boundary.

## Browser Verification

`npm run test:browser` runs a headless Chromium smoke test with:

- PGlite using `opfs-ahp://` inside a Web Worker
- OPFS blob cache
- `createLocalWorkspaceFs()`

This catches issues that DOM shims cannot, especially OPFS access-handle behavior.
