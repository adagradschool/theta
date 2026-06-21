import {
	basenameWorkspacePath,
	dirnameWorkspacePath,
	type FileStat,
	normalizeWorkspacePath,
} from "../filesystem.ts";
import type { JsonObject, JsonValue } from "../json.ts";
import type {
	LocalWorkspaceEntryRecord,
	LocalWorkspaceFileVersionRecord,
} from "./types.ts";

export function makeEntry(
	input: Omit<LocalWorkspaceEntryRecord, "parentPath" | "name">,
): LocalWorkspaceEntryRecord {
	const path = normalizeWorkspacePath(input.path);
	const base = {
		workspaceId: input.workspaceId,
		path,
		parentPath: dirnameWorkspacePath(path),
		name: basenameWorkspacePath(path),
		kind: input.kind,
		version: input.version,
		size: input.size,
		createdAt: input.createdAt,
		updatedAt: input.updatedAt,
	};
	return {
		...base,
		...(input.contentHash !== undefined
			? { contentHash: input.contentHash }
			: {}),
		...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
		...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
		...(input.blobSyncStatus !== undefined
			? { blobSyncStatus: input.blobSyncStatus }
			: {}),
		...(input.createdByDeviceId !== undefined
			? { createdByDeviceId: input.createdByDeviceId }
			: {}),
		...(input.updatedByDeviceId !== undefined
			? { updatedByDeviceId: input.updatedByDeviceId }
			: {}),
		...(input.deletedAt !== undefined ? { deletedAt: input.deletedAt } : {}),
	};
}

export function cloneEntry(
	entry: LocalWorkspaceEntryRecord,
): LocalWorkspaceEntryRecord {
	return {
		...entry,
		...(entry.metadata !== undefined
			? { metadata: { ...entry.metadata } }
			: {}),
	};
}

export function cloneFileVersion(
	version: LocalWorkspaceFileVersionRecord,
): LocalWorkspaceFileVersionRecord {
	return { ...version };
}

export function toFileStat(entry: LocalWorkspaceEntryRecord): FileStat {
	return {
		path: entry.path,
		kind: entry.kind,
		size: entry.size,
		mtime: entry.updatedAt,
		version: entry.version,
		...(entry.contentHash !== undefined
			? { contentHash: entry.contentHash }
			: {}),
		...(entry.mimeType !== undefined ? { mimeType: entry.mimeType } : {}),
		...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
	};
}

export function parseMetadata(
	metadataJson: string | null,
): JsonObject | undefined {
	if (metadataJson === null) {
		return undefined;
	}
	const parsed = JSON.parse(metadataJson) as JsonValue;
	return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as JsonObject)
		: undefined;
}

export function numberFromPg(value: number | string): number {
	return typeof value === "number" ? value : Number.parseInt(value, 10);
}

export function nextVersion(version: string | undefined): string {
	if (version === undefined) {
		return "1";
	}
	const parsed = Number.parseInt(version, 10);
	return Number.isFinite(parsed) ? String(parsed + 1) : `${version}.1`;
}

export function entryKey(workspaceId: string, path: string): string {
	return `${workspaceId}\0${path}`;
}

export function versionKey(workspaceId: string, path: string): string {
	return `${workspaceId}\0${path}`;
}

export function isDescendantPath(parent: string, child: string): boolean {
	return child.startsWith(`${parent}/`);
}

export function isWatchedPath(
	watchPath: string,
	path: string,
	previousPath: string | undefined,
): boolean {
	return (
		watchPath === "/" ||
		path === watchPath ||
		isDescendantPath(watchPath, path) ||
		previousPath === watchPath ||
		(previousPath !== undefined && isDescendantPath(watchPath, previousPath))
	);
}
