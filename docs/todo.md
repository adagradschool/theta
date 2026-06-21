# Todo

End goal: publish Theta as an npm package that can be pulled into any browser project to provide a client-side coding agent workspace.

## 1. Package Foundation

1. Create a TypeScript package scaffold.
2. Configure ESM package exports.
3. Add browser-oriented build output.
4. Add type declarations.
5. Add lint, format, and typecheck commands.
6. Add a minimal test setup.
7. Add package metadata for npm publishing.
8. Define the public package name.
9. Define supported runtime targets.
10. Document browser-only and server-proxy requirements.

## 2. Public API Shape

1. Define the top-level `createThetaWorkspace` API.
2. Define the top-level `createThetaAgent` API.
3. Define exported runtime types.
4. Define stable event types for UI consumers.
5. Define package entrypoints.
6. Separate browser entrypoints from server helper entrypoints.
7. Add API docs for the intended integration path.

## 3. Workspace Filesystem

1. Define the `WorkspaceFs` interface.
2. Define `FileStat`, `DirEntry`, `FsEvent`, and write option types.
3. Define path normalization rules.
4. Define binary and text file handling.
5. Define error types for missing files, conflicts, invalid paths, and permissions.
6. Implement an in-memory `WorkspaceFs`.
7. Add filesystem contract tests.
8. Add watch/event tests.

## 4. Local Browser Storage

1. Pick IndexedDB, OPFS, or a hybrid strategy.
2. Implement persistent file storage behind `WorkspaceFs`.
3. Implement directory indexing.
4. Implement content hashing.
5. Implement file version tracking.
6. Implement atomic write semantics where possible.
7. Add migration/version metadata.
8. Add storage tests using a browser-compatible test environment.

## 5. Pi Agent Runtime Integration

1. Add `@earendil-works/pi-agent-core` dependency.
2. Add `@earendil-works/pi-ai` dependency if needed for shared types.
3. Create a browser agent factory using `pi-agent-core/base`.
4. Wire agent lifecycle events into Theta events.
5. Add queue handling for steering and follow-up messages.
6. Add abort handling.
7. Add model and thinking-level state.
8. Add integration tests with a faux stream function.

## 6. LLM Proxy Contract

1. Define the server proxy request shape.
2. Define the streamed proxy event shape.
3. Reuse or mirror Pi's `streamProxy` behavior.
4. Add auth token injection for app-level auth.
5. Add abort propagation.
6. Add proxy error handling.
7. Add a minimal server helper for provider streaming.
8. Add tests for streaming reconstruction.

## 7. Message Model

1. Define Theta-specific message types.
2. Reimplement Pi-style `convertToLlm`.
3. Add custom message support.
4. Add bash execution message support.
5. Add compaction summary message support.
6. Add branch summary message support if sessions support branching.
7. Add serialization tests.
8. Add LLM conversion tests.

## 8. Browser Tools

1. Define a tool factory API.
2. Implement `read`.
3. Implement `write`.
4. Implement `edit`.
5. Implement `ls`.
6. Implement `grep`.
7. Implement `find`.
8. Add tool result details for UI rendering.
9. Add tests for each tool.
10. Add tests for tool errors and edge cases.

## 9. just-bash Integration

1. Vendor a slim browser shell instead of adding the full `just-bash` dependency.
2. Build a `WorkspaceFs` adapter for the browser shell.
3. Implement the `bash` tool.
4. Capture stdout, stderr, exit code, and cancellation state.
5. Add command timeout support.
6. Add output truncation.
7. Add environment variable support.
8. Add tests for common shell commands.
9. Add tests for filesystem mutations through bash.

## 10. Sessions

Status: implemented locally with in-memory and PGlite-backed durable stores, session restore, active branches, forked branches, model/thinking/custom/message entries, unit tests, and a persistence smoke test. Electric sync is still later.

1. Define session entry types.
2. Define session tree and parent-child relationships.
3. Implement an in-memory session manager.
4. Implement persistent browser session storage.
5. Add active branch handling.
6. Add append message behavior.
7. Add model and thinking-level change entries.
8. Add custom entries.
9. Add session restore.
10. Add session fork/branch behavior if needed.
11. Add session tests.

## 11. Durable Browser Persistence

Status: implemented with a PGlite metadata/control-plane store, OPFS content-addressed blob cache, PGlite-backed session store, schema migrations, unit tests, and a headless Chrome smoke that writes data, restarts the browser context, and reads it back. Large-workspace quota stress testing is still limited to the storage-estimate hook points rather than a full 100s-of-MB fixture.

1. Use a PGlite-backed store for durable browser sessions.
2. Run PGlite on OPFS so workspace state survives reloads, browser restarts, and large local workspaces.
3. Define the local durable schema for workspaces, file metadata, file manifests, sessions, branches, and session entries.
4. Store file bytes as content-addressed blobs in OPFS, not inline database payloads.
5. Store file metadata, directory indexes, versions, hashes, and sync state in PGlite.
6. Implement a `WorkspaceFs` adapter over the PGlite metadata store and OPFS blob store.
7. Implement atomic write flow: write blob, commit metadata transaction, then emit filesystem events.
8. Add migration/version metadata for local schema changes.
9. Add quota, storage-estimate, and large-file behavior checks for workspaces in the 100s of MB range.
10. Add real-browser persistence tests with headless Chrome that verify data survives page reload and context restart.

## 12. Content-Addressed Blob Sync

Status: first slice implemented with an HTTP blob-store client, host-provided headers, content-hash validation, workspace manifest export/import, blob upload/download helpers, blob sync status metadata, device metadata, and a two-device deterministic sync test. Server-side R2/S3 helper, retries/resumability, garbage collection, and large-file browser integration remain.

1. Define blob identity as hash plus size and content type where useful.
2. Define file manifest records that map paths and versions to blob identities.
3. Define a minimal blob-store interface for upload, download, exists/head, and delete/garbage collection.
4. Add a cheap stateless server helper for blob transfer, backed by R2/S3-compatible storage or a host-provided implementation.
5. Upload missing local blobs after metadata commits.
6. Download missing remote blobs before exposing synced files as readable.
7. Validate downloaded blobs by hash before committing them to OPFS.
8. Track blob sync status separately from metadata sync status.
9. Add retry, backoff, resumability, and cancellation for large blob transfers.
10. Add garbage-collection rules for unreferenced local and remote blobs.
11. Add browser integration tests for multi-file, binary-file, and large-file blob sync.

## 13. Electric SQL Sync

Status: first local shape boundary implemented as workspace manifest export/import over PGlite metadata, including device fields and blob status. Electric Cloud claimable Postgres+Sync is provisioned, the Cloudflare Worker proxies Electric shape reads with server-side source credentials, `syncThetaElectricWorkspaceMetadata()` syncs workspace entry/file-version shapes into PGlite, and `syncThetaWorkspaceToRemote()` uploads queued file blobs before flushing workspace metadata mutations through the Worker into Postgres. Session shapes, offline retry scheduling, and conflict reconciliation remain.

1. Define the Postgres schema for workspaces, file manifests, sessions, branches, session entries, devices, and sync metadata.
2. Keep blob bytes out of Electric/Postgres; sync only metadata, manifests, hashes, versions, and blob references.
3. Mirror the Postgres schema into PGlite-compatible local tables.
4. Implement Electric shape subscriptions for workspace metadata, file manifests, sessions, and session entries.
5. Implement local mutation recording for file operations and session operations.
6. Sync local mutations through Electric/Postgres while preserving local-first writes.
7. Add device identity and created-by-device metadata.
8. Add sync status events for metadata sync, blob upload, blob download, conflicts, and offline state.
9. Add offline, reconnect, and multi-device convergence behavior.
10. Add tests that verify a file edit on one browser profile appears on another profile after Electric and blob sync complete.
11. Add tests that verify sessions restore across devices.

## 14. Compaction

Status: implemented with browser-safe token estimation, threshold helpers, turn-start cut-point selection, summary prompt creation, caller-provided LLM summary generation, durable session compaction entries, PGlite persistence, restore from compaction summaries, manual compaction API, automatic `createThetaAgent` session compaction, and faux-model/unit coverage.

1. Port the browser-safe compaction concepts from Pi.
2. Define compaction settings.
3. Implement token estimation.
4. Implement cut-point selection.
5. Implement summary prompt creation.
6. Generate summaries through the LLM proxy.
7. Store compaction entries in sessions.
8. Persist compaction entries through PGlite and sync them through Electric.
9. Restore context from compaction summaries.
10. Add manual compaction API.
11. Add automatic compaction thresholds.
12. Add compaction tests with a faux model.

## 15. Conflict Handling

Status: first slice implemented with structured stale-write errors for optimistic expected-version writes, ETag-style expected-version checks on server mutations, and a safe text merge helper for simple non-overlapping edits. Conflict artifact creation, sync reconciliation, UI conflict events, and resolution helpers remain.

1. Add expected-version writes.
2. Detect stale writes.
3. Implement safe text merge for simple non-overlapping edits.
4. Create conflict artifacts when automatic merge is unsafe.
5. Surface conflicts through `WorkspaceFs`.
6. Add conflict status events.
7. Add conflict resolution helpers.
8. Reconcile conflicts across PGlite metadata, OPFS blobs, and Electric-synced manifests.
9. Add conflict tests.

## 16. UI Integration Helpers

Status: implemented with framework-free headless helpers for chat state, file tree events, editor bindings, tool render metadata, progress/working state, and sync status summaries. An opt-in `./react` entrypoint layers hooks over those helpers with React as an optional peer dependency; the core/browser entrypoints remain UI-dependency-free.

1. Define a headless state adapter for chat UIs.
2. Define file tree event helpers.
3. Define editor binding helpers.
4. Define tool-render metadata.
5. Define progress and working-state events.
6. Define persistence and sync status helpers.
7. Add example React hooks only if they do not constrain the core package.

## 17. Example App

1. Create a minimal example app.
2. Wire the browser agent.
3. Wire the PGlite/OPFS-backed workspace filesystem.
4. Wire browser tools.
5. Wire the LLM proxy.
6. Add a simple file tree.
7. Add a simple editor.
8. Add a chat panel.
9. Add browser shell command execution.
10. Add local persistence smoke controls that survive reloads.
11. Add blob sync and Electric sync in the example after the local-only flow works.

## 18. Server Helpers

1. Create an optional server entrypoint.
2. Implement an LLM proxy handler.
3. Keep provider credentials server-only.
4. Add provider selection configuration.
5. Add app auth hook points.
6. Add request validation.
7. Add rate-limit hook points.
8. Add optional stateless blob transfer helpers for R2/S3-compatible storage.
9. Add Electric/Postgres deployment notes.
10. Add deployment docs.

## 19. Testing

1. Add unit tests for filesystem behavior.
2. Add unit tests for tools.
3. Add unit tests for message conversion.
4. Add unit tests for sessions.
5. Add unit tests for compaction.
6. Add integration tests for agent tool loops.
7. Add browser bundle smoke tests.
8. Add example app smoke tests.
9. Add real-browser OPFS/PGlite persistence tests.
10. Add blob sync integration tests.
11. Add Electric sync integration tests.
12. Add multi-device convergence tests.

## 20. Documentation

1. Write installation docs.
2. Write quick-start docs.
3. Write browser integration docs.
4. Write LLM proxy docs.
5. Write `WorkspaceFs` adapter docs.
6. Write tool customization docs.
7. Write session and compaction docs.
8. Write PGlite/OPFS persistence docs.
9. Write content-addressed blob sync docs.
10. Write Electric sync docs.
11. Write conflict handling docs.
12. Write example app walkthrough.

## 21. Publishing

1. Confirm package name and scope.
2. Confirm license.
3. Add npm files allowlist.
4. Add release script.
5. Add changelog.
6. Run typecheck.
7. Run tests.
8. Run browser bundle smoke test.
9. Pack locally with `npm pack`.
10. Install the packed tarball into a separate sample project.
11. Verify browser integration from the packed package.
12. Publish to npm.
