import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import {
	createLocalWorkspaceFs,
	createMemoryBlobStorage,
	createPGliteWorkspaceMetadataStore,
	createPGliteWorkspaceMutationQueue,
	flushThetaWorkspaceMutationQueue,
	syncThetaWorkspaceToRemote,
	type ThetaWorkspaceMutationRequest,
} from "../src/index.ts";

describe("workspace mutation queue", () => {
	it("queues local workspace writes and flushes them to a mutation endpoint", async () => {
		const pg = new PGlite();
		await pg.waitReady;
		const metadata = createPGliteWorkspaceMetadataStore(pg);
		const queue = createPGliteWorkspaceMutationQueue({
			pg,
			metadata,
			now: fixedClock(1000),
			createId: fixedIds("mut-1", "mut-2", "mut-3"),
		});
		const fs = createLocalWorkspaceFs({
			workspaceId: "workspace",
			metadata,
			blobs: createMemoryBlobStorage(),
			mutationQueue: queue,
			now: fixedClock(2000),
		});

		await fs.mkdir("/src");
		await fs.writeTextFile("/src/index.ts", "export const value = 1;");

		const pending = await queue.listPending("workspace");
		expect(pending.map((mutation) => mutation.kind)).toEqual([
			"putEntry",
			"putEntry",
			"recordFileVersion",
		]);

		let request: ThetaWorkspaceMutationRequest | undefined;
		const result = await flushThetaWorkspaceMutationQueue({
			workspaceId: "workspace",
			queue,
			endpoint: {
				url: "https://theta.example.test/v1/mutations/workspace",
				headers: { Authorization: "Bearer token" },
				fetch: async (_input, init) => {
					request = JSON.parse(
						String(init?.body),
					) as ThetaWorkspaceMutationRequest;
					return Response.json({ ok: true, applied: request.mutations.length });
				},
			},
		});

		expect(result).toEqual({ sent: 3, synced: 3, failed: 0, remaining: 0 });
		expect(request?.workspaceId).toBe("workspace");
		expect(request?.mutations.map((mutation) => mutation.kind)).toEqual([
			"putEntry",
			"putEntry",
			"recordFileVersion",
		]);
		const filePut = request?.mutations.find(
			(mutation) =>
				mutation.kind === "putEntry" && mutation.entry.path === "/src/index.ts",
		);
		expect(filePut).toMatchObject({ kind: "putEntry" });
		if (filePut?.kind !== "putEntry") {
			throw new Error("Expected file put mutation.");
		}
		expect(filePut.expectedVersion).toBeUndefined();
		expect(await queue.listPending("workspace")).toEqual([]);

		await pg.close();
	});

	it("keeps failed mutations queued with attempt metadata", async () => {
		const pg = new PGlite();
		await pg.waitReady;
		const metadata = createPGliteWorkspaceMetadataStore(pg);
		const queue = createPGliteWorkspaceMutationQueue({
			pg,
			metadata,
			createId: fixedIds("mut-1"),
		});
		await queue.enqueue([
			{
				kind: "deleteEntry",
				workspaceId: "workspace",
				path: "/gone.txt",
			},
		]);

		const result = await flushThetaWorkspaceMutationQueue({
			workspaceId: "workspace",
			queue,
			endpoint: {
				url: "https://theta.example.test/v1/mutations/workspace",
				fetch: async () => new Response("nope", { status: 500 }),
			},
		});

		const [failed] = await queue.listPending("workspace");
		expect(result).toEqual({ sent: 1, synced: 0, failed: 1, remaining: 1 });
		expect(failed).toMatchObject({ attempts: 1, lastError: "nope" });

		await pg.close();
	});

	it("queues expected versions for updates and preserves stale server conflicts", async () => {
		const pg = new PGlite();
		await pg.waitReady;
		const metadata = createPGliteWorkspaceMetadataStore(pg);
		const queue = createPGliteWorkspaceMutationQueue({
			pg,
			metadata,
			createId: fixedIds("mut-1", "mut-2", "mut-3", "mut-4"),
		});
		const fs = createLocalWorkspaceFs({
			workspaceId: "workspace",
			metadata,
			blobs: createMemoryBlobStorage(),
			mutationQueue: queue,
		});
		await fs.writeTextFile("/file.txt", "one");
		await queue.markSynced(
			(await queue.listPending("workspace")).map((m) => m.id),
		);

		await fs.writeTextFile("/file.txt", "two");
		const [put, version] = await queue.listPending("workspace");
		expect(put).toMatchObject({
			kind: "putEntry",
			payload: { kind: "putEntry", expectedVersion: "1" },
		});
		expect(version).toMatchObject({ kind: "recordFileVersion" });

		const result = await flushThetaWorkspaceMutationQueue({
			workspaceId: "workspace",
			queue,
			endpoint: {
				url: "https://theta.example.test/v1/mutations/workspace",
				fetch: async () =>
					Response.json(
						{
							error: "Workspace mutation conflict.",
							conflicts: [
								{
									path: "/file.txt",
									expectedVersion: "1",
									actualVersion: "2",
								},
							],
						},
						{ status: 409 },
					),
			},
		});

		const failed = await queue.listPending("workspace");
		expect(result).toEqual({ sent: 2, synced: 0, failed: 2, remaining: 2 });
		expect(failed.map((record) => record.attempts)).toEqual([1, 1]);
		expect(failed[0]?.lastError).toContain("Workspace mutation conflict");

		await pg.close();
	});

	it("uploads queued file blobs before flushing metadata mutations", async () => {
		const pg = new PGlite();
		await pg.waitReady;
		const metadata = createPGliteWorkspaceMetadataStore(pg);
		const blobs = createMemoryBlobStorage();
		const remoteBlobs = createMemoryBlobStorage();
		const queue = createPGliteWorkspaceMutationQueue({
			pg,
			metadata,
			createId: fixedIds("mut-1", "mut-2", "mut-3"),
		});
		const fs = createLocalWorkspaceFs({
			workspaceId: "workspace",
			metadata,
			blobs,
			mutationQueue: queue,
		});
		await fs.mkdir("/src");
		await fs.writeTextFile("/src/index.ts", "export const value = 1;");

		const events: string[] = [];
		let request: ThetaWorkspaceMutationRequest | undefined;
		const result = await syncThetaWorkspaceToRemote({
			workspaceId: "workspace",
			queue,
			metadata,
			cache: blobs,
			blobStore: remoteBlobs,
			endpoint: {
				url: "https://theta.example.test/v1/mutations/workspace",
				fetch: async (_input, init) => {
					const entry = await metadata.getEntry("workspace", "/src/index.ts");
					if (
						!entry?.contentHash ||
						!(await remoteBlobs.has(entry.contentHash))
					) {
						throw new Error(
							"Expected blob to be uploaded before mutation flush.",
						);
					}
					events.push("flush");
					request = JSON.parse(
						String(init?.body),
					) as ThetaWorkspaceMutationRequest;
					return Response.json({ ok: true, applied: request.mutations.length });
				},
			},
		});

		expect(events).toEqual(["flush"]);
		expect(result.mutations).toMatchObject({ sent: 3, synced: 3, failed: 0 });
		expect(result.blobs.map((blob) => blob.status)).toContain("uploaded");
		expect(await metadata.getEntry("workspace", "/src/index.ts")).toMatchObject(
			{
				blobSyncStatus: "uploaded",
			},
		);
		expect(await queue.listPending("workspace")).toEqual([]);

		await pg.close();
	});
});

function fixedClock(start: number): () => number {
	let value = start;
	return () => {
		const current = value;
		value += 1;
		return current;
	};
}

function fixedIds(...ids: readonly string[]): () => string {
	let index = 0;
	return () => {
		const id = ids[index];
		index += 1;
		if (!id) {
			throw new Error("Ran out of ids.");
		}
		return id;
	};
}
