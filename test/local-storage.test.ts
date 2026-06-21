import { describe, expect, it } from "vitest";

import {
	createLocalWorkspaceFs,
	createMemoryBlobStorage,
	createMemoryLocalWorkspaceFs,
	createMemoryPGliteWorkspaceMetadataStore,
	THETA_LOCAL_STORAGE_SCHEMA_VERSION,
	THETA_LOCAL_STORAGE_STRATEGY,
	WorkspaceStaleWriteError,
} from "../src/index.ts";

describe("local browser storage strategy", () => {
	it("declares PGlite plus OPFS plus Electric as the selected architecture", () => {
		expect(THETA_LOCAL_STORAGE_STRATEGY).toEqual({
			controlPlane: "pglite",
			fileBytes: "opfs",
			durableSync: "postgres-electric",
		});
	});

	it("migrates metadata schema and tracks file versions through WorkspaceFs", async () => {
		const metadata = createMemoryPGliteWorkspaceMetadataStore();
		const fs = createLocalWorkspaceFs({
			workspaceId: "workspace",
			metadata,
			blobs: createMemoryBlobStorage(),
			now: () => 1000,
		});

		await fs.mkdir("/src");
		await fs.writeTextFile("/src/index.ts", "one");
		const first = await fs.stat("/src/index.ts");
		if (first.version === undefined) {
			throw new Error("Expected first file version to be defined.");
		}
		await fs.writeTextFile("/src/index.ts", "two", {
			expectedVersion: first.version,
			mimeType: "text/typescript",
			metadata: { language: "ts" },
		});
		const second = await fs.stat("/src/index.ts");
		const versions = await metadata.listFileVersions(
			"workspace",
			"/src/index.ts",
		);

		expect(await metadata.getSchemaVersion()).toBe(
			THETA_LOCAL_STORAGE_SCHEMA_VERSION,
		);
		expect(second.version).not.toBe(first.version);
		expect(second.mimeType).toBe("text/typescript");
		expect(second.metadata).toEqual({ language: "ts" });
		expect(versions).toHaveLength(2);
		expect(versions.map((version) => version.contentHash)).toEqual([
			first.contentHash,
			second.contentHash,
		]);
	});

	it("preserves metadata across WorkspaceFs instances that share the same store and blob cache", async () => {
		const metadata = createMemoryPGliteWorkspaceMetadataStore();
		const blobs = createMemoryBlobStorage();
		const first = createLocalWorkspaceFs({
			workspaceId: "workspace",
			metadata,
			blobs,
		});
		await first.mkdir("/docs");
		await first.writeTextFile("/docs/readme.md", "persisted");

		const second = createLocalWorkspaceFs({
			workspaceId: "workspace",
			metadata,
			blobs,
		});

		expect(await second.readTextFile("/docs/readme.md")).toBe("persisted");
		expect((await second.readdir("/docs")).map((entry) => entry.name)).toEqual([
			"readme.md",
		]);
	});

	it("enforces compare-and-set writes at the metadata layer", async () => {
		const fs = createMemoryLocalWorkspaceFs();
		await fs.writeTextFile("/file.txt", "one");

		await expect(
			fs.writeTextFile("/file.txt", "two", { expectedVersion: "stale" }),
		).rejects.toMatchObject({
			name: "WorkspaceStaleWriteError",
			path: "/file.txt",
			expectedVersion: "stale",
			actualVersion: "1",
		});
		await expect(
			fs.writeTextFile("/file.txt", "two", { expectedVersion: "stale" }),
		).rejects.toBeInstanceOf(WorkspaceStaleWriteError);
	});
});
