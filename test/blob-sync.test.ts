import { describe, expect, it } from "vitest";

import {
	BlobHashMismatchError,
	BlobNotFoundError,
	createHttpBlobStore,
	createMemoryBlobStorage,
	ensureBlobInCache,
	ensureBlobInStore,
	hashBlobBytes,
	readBlobBytes,
	syncBlobsToCache,
	syncBlobsToStore,
	type ContentHash,
} from "../src/index.ts";

describe("content-addressed blob sync", () => {
	it("hashes bytes with stable sha256 content addresses", async () => {
		const hash = await hashBlobBytes(new TextEncoder().encode("hello"));

		expect(hash).toBe(
			"sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		);
	});

	it("stores defensive byte copies", async () => {
		const cache = createMemoryBlobStorage();
		const bytes = new Uint8Array([1, 2, 3]);
		const descriptor = await cache.put(bytes);
		bytes[0] = 9;

		const firstRead = await cache.get(descriptor.hash);
		expect(Array.from(firstRead)).toEqual([1, 2, 3]);
		firstRead[1] = 9;
		expect(Array.from(await cache.get(descriptor.hash))).toEqual([1, 2, 3]);
	});

	it("validates expected hashes on writes", async () => {
		const cache = createMemoryBlobStorage();
		const expected = (await hashBlobBytes(new Uint8Array([1]))) as ContentHash;

		await expect(cache.put(new Uint8Array([2]), expected)).rejects.toThrow(
			BlobHashMismatchError,
		);
	});

	it("uploads missing cached blobs to a remote store", async () => {
		const cache = createMemoryBlobStorage();
		const store = createMemoryBlobStorage();
		const descriptor = await cache.put(new TextEncoder().encode("file"));

		await expect(store.get(descriptor.hash)).rejects.toThrow(BlobNotFoundError);
		await expect(
			ensureBlobInStore(cache, store, descriptor.hash),
		).resolves.toEqual({
			hash: descriptor.hash,
			status: "uploaded",
			size: descriptor.size,
		});
		expect(await store.get(descriptor.hash)).toEqual(
			new TextEncoder().encode("file"),
		);
		await expect(
			ensureBlobInStore(cache, store, descriptor.hash),
		).resolves.toEqual({
			hash: descriptor.hash,
			status: "already-present",
			size: descriptor.size,
		});
	});

	it("downloads remote blobs into the local cache", async () => {
		const cache = createMemoryBlobStorage();
		const store = createMemoryBlobStorage();
		const descriptor = await store.put(new TextEncoder().encode("remote"));

		await expect(
			ensureBlobInCache(cache, store, descriptor.hash),
		).resolves.toEqual({
			hash: descriptor.hash,
			status: "downloaded",
			size: descriptor.size,
		});
		expect(await cache.get(descriptor.hash)).toEqual(
			new TextEncoder().encode("remote"),
		);
	});

	it("reports missing blobs without throwing during sync helpers", async () => {
		const cache = createMemoryBlobStorage();
		const store = createMemoryBlobStorage();
		const missing =
			"sha256:0000000000000000000000000000000000000000000000000000000000000000";

		await expect(ensureBlobInStore(cache, store, missing)).resolves.toEqual({
			hash: missing,
			status: "missing",
		});
		await expect(ensureBlobInCache(cache, store, missing)).resolves.toEqual({
			hash: missing,
			status: "missing",
		});
	});

	it("syncs batches sequentially for predictable queue behavior", async () => {
		const cache = createMemoryBlobStorage();
		const store = createMemoryBlobStorage();
		const first = await cache.put(new Uint8Array([1]));
		const second = await store.put(new Uint8Array([2]));

		expect(
			await syncBlobsToStore(cache, store, [first.hash, second.hash]),
		).toEqual([
			{ hash: first.hash, status: "uploaded", size: first.size },
			{ hash: second.hash, status: "already-present", size: second.size },
		]);
		await store.delete(first.hash);
		expect(
			await syncBlobsToCache(cache, store, [first.hash, second.hash]),
		).toEqual([
			{ hash: first.hash, status: "already-present", size: first.size },
			{ hash: second.hash, status: "downloaded", size: second.size },
		]);
	});

	it("reads blobs from streams", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2]));
				controller.enqueue(new Uint8Array([3]));
				controller.close();
			},
		});

		expect(Array.from(await readBlobBytes(stream))).toEqual([1, 2, 3]);
	});

	it("uses HTTP blob stores with host-provided headers", async () => {
		const backing = createMemoryBlobStorage();
		const seen: Array<{ method: string; authorization: string | null }> = [];
		const store = createHttpBlobStore({
			baseUrl: "https://blob.example/blobs",
			headers: { Authorization: "Bearer app-token" },
			fetch: async (input, init) => {
				const url = new URL(String(input));
				const hash = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
				const headers = new Headers(init?.headers);
				seen.push({
					method: init?.method ?? "GET",
					authorization: headers.get("authorization"),
				});
				if (init?.method === "PUT") {
					const body = init.body;
					if (!(body instanceof ArrayBuffer)) {
						throw new Error("Expected ArrayBuffer body.");
					}
					await backing.put(new Uint8Array(body), hash as ContentHash);
					return new Response(null, { status: 204 });
				}
				if (init?.method === "HEAD") {
					return new Response(null, {
						status: (await backing.has(hash as ContentHash)) ? 204 : 404,
						headers: (await backing.has(hash as ContentHash))
							? {
									"content-length": String(
										(await backing.stat(hash as ContentHash)).size,
									),
								}
							: {},
					});
				}
				if (init?.method === "GET") {
					try {
						return new Response(
							toArrayBuffer(await backing.get(hash as ContentHash)),
						);
					} catch {
						return new Response(null, { status: 404 });
					}
				}
				return new Response(null, { status: 405 });
			},
		});
		const descriptor = await store.put(new TextEncoder().encode("http"));

		expect(await store.has(descriptor.hash)).toBe(true);
		expect(await store.get(descriptor.hash)).toEqual(
			new TextEncoder().encode("http"),
		);
		expect(seen.map((request) => request.authorization)).toEqual([
			"Bearer app-token",
			"Bearer app-token",
			"Bearer app-token",
		]);
	});
});

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}
