# Electric Metadata Sync

Theta syncs metadata rows through Electric and keeps file bytes in R2.

## Runtime Shape

- Browser clients store local metadata in PGlite.
- `syncThetaElectricWorkspaceMetadata()` subscribes PGlite to Electric shapes for workspace entries and file versions.
- Local writes can enqueue metadata mutations with `createPGliteWorkspaceMutationQueue()`.
- `syncThetaWorkspaceToRemote()` uploads queued file blobs to R2 before flushing metadata mutations to the app server.
- `flushThetaWorkspaceMutationQueue()` is available when callers need to flush metadata only.
- The Cloudflare Worker exposes `/v1/electric/shape` and injects Electric Cloud source credentials server-side.
- The Cloudflare Worker exposes `/v1/mutations/workspace` and applies workspace metadata mutations to Postgres.
- Browser clients authenticate to the Worker with the app bearer token; Electric source secrets are not exposed to the browser.

## Current Slice

The implemented sync path covers:

- `theta_workspace_entries`
- `theta_file_versions`
- queued `putEntry`, `recordFileVersion`, and `deleteEntry` mutations
- ETag-style `expectedVersion` checks for queued updates and deletes

The smoke script writes through `WorkspaceFs`, uploads the queued file blob to R2, flushes queued metadata mutations to the Worker, and verifies two separate PGlite clients receive the same rows through Electric and materialize the file bytes from R2.

```sh
npm run build
set -a; source .env; set +a
node scripts/electric-metadata-sync-smoke.mjs
```

Sessions, offline retry scheduling, and conflict reconciliation still need to be layered on top.

## Conflict Policy

Workspace metadata writes are last-write-wins by default. When a queued mutation includes `expectedVersion`, the Worker checks the current Postgres row before applying the batch. If the current version does not match, the Worker returns `409` with conflict details and the client leaves the queued mutations pending with the error recorded.
