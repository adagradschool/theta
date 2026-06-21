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

## 11. Compaction

1. Port the browser-safe compaction concepts from Pi.
2. Define compaction settings.
3. Implement token estimation.
4. Implement cut-point selection.
5. Implement summary prompt creation.
6. Generate summaries through the LLM proxy.
7. Store compaction entries in sessions.
8. Restore context from compaction summaries.
9. Add manual compaction API.
10. Add automatic compaction thresholds.
11. Add compaction tests with a faux model.

## 12. Electric Sync

1. Define durable schema for workspaces.
2. Define durable schema for workspace files.
3. Define durable schema for sessions.
4. Define durable schema for session entries.
5. Implement Electric shape subscriptions.
6. Map synced records into local browser storage.
7. Sync local file mutations.
8. Sync local session mutations.
9. Add device identity.
10. Add sync status events.
11. Add offline and reconnect handling.
12. Add sync integration tests.

## 13. Conflict Handling

1. Add expected-version writes.
2. Detect stale writes.
3. Implement safe text merge for simple non-overlapping edits.
4. Create conflict artifacts when automatic merge is unsafe.
5. Surface conflicts through `WorkspaceFs`.
6. Add conflict status events.
7. Add conflict resolution helpers.
8. Add conflict tests.

## 14. UI Integration Helpers

1. Define a headless state adapter for chat UIs.
2. Define file tree event helpers.
3. Define editor binding helpers.
4. Define tool-render metadata.
5. Define progress and working-state events.
6. Add example React hooks only if they do not constrain the core package.

## 15. Example App

1. Create a minimal example app.
2. Wire the browser agent.
3. Wire the local workspace filesystem.
4. Wire browser tools.
5. Wire the LLM proxy.
6. Add a simple file tree.
7. Add a simple editor.
8. Add a chat panel.
9. Add browser shell command execution.
10. Add Electric sync in the example after the local-only flow works.

## 16. Server Helpers

1. Create an optional server entrypoint.
2. Implement an LLM proxy handler.
3. Keep provider credentials server-only.
4. Add provider selection configuration.
5. Add app auth hook points.
6. Add request validation.
7. Add rate-limit hook points.
8. Add deployment docs.

## 17. Testing

1. Add unit tests for filesystem behavior.
2. Add unit tests for tools.
3. Add unit tests for message conversion.
4. Add unit tests for sessions.
5. Add unit tests for compaction.
6. Add integration tests for agent tool loops.
7. Add browser bundle smoke tests.
8. Add example app smoke tests.
9. Add sync integration tests.

## 18. Documentation

1. Write installation docs.
2. Write quick-start docs.
3. Write browser integration docs.
4. Write LLM proxy docs.
5. Write `WorkspaceFs` adapter docs.
6. Write tool customization docs.
7. Write session and compaction docs.
8. Write Electric sync docs.
9. Write conflict handling docs.
10. Write example app walkthrough.

## 19. Publishing

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
