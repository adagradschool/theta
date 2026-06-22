import { createMemoryBlobStorage } from "../sync/blob-sync.ts";
import type { WorkspaceFs } from "../fs/filesystem.ts";
import { createLocalWorkspaceFs } from "./local-workspace-fs.ts";
import { createMemoryPGliteWorkspaceMetadataStore } from "./memory-metadata-store.ts";
import type { CreateMemoryLocalWorkspaceFsOptions } from "./types.ts";

export function createMemoryLocalWorkspaceFs(
	options: CreateMemoryLocalWorkspaceFsOptions = {},
): WorkspaceFs {
	return createLocalWorkspaceFs({
		workspaceId: options.workspaceId ?? "memory-workspace",
		metadata: createMemoryPGliteWorkspaceMetadataStore(),
		blobs: createMemoryBlobStorage({
			...(options.now !== undefined ? { now: options.now } : {}),
		}),
		...(options.now !== undefined ? { now: options.now } : {}),
	});
}
