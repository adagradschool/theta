export type ContentHash = `sha256:${string}`;

export type BlobBytes = Uint8Array | ReadableStream<Uint8Array>;

export interface ContentBlobDescriptor {
	readonly hash: ContentHash;
	readonly size: number;
}

export interface ContentBlobStat extends ContentBlobDescriptor {
	readonly updatedAt?: number;
}

export interface BlobCache {
	has(hash: ContentHash): Promise<boolean>;
	get(hash: ContentHash): Promise<Uint8Array>;
	put(
		bytes: BlobBytes,
		expectedHash?: ContentHash,
	): Promise<ContentBlobDescriptor>;
	delete(hash: ContentHash): Promise<void>;
	stat(hash: ContentHash): Promise<ContentBlobStat>;
}

export interface BlobStore {
	has(hash: ContentHash): Promise<boolean>;
	get(hash: ContentHash): Promise<Uint8Array>;
	put(
		bytes: BlobBytes,
		expectedHash?: ContentHash,
	): Promise<ContentBlobDescriptor>;
	delete?(hash: ContentHash): Promise<void>;
	stat?(hash: ContentHash): Promise<ContentBlobStat>;
}

export type BlobTransferStatus =
	| "already-present"
	| "uploaded"
	| "downloaded"
	| "missing";

export interface BlobTransferResult {
	readonly hash: ContentHash;
	readonly status: BlobTransferStatus;
	readonly size?: number;
}

export class BlobNotFoundError extends Error {
	readonly hash: ContentHash;

	constructor(hash: ContentHash) {
		super(`Content blob not found: ${hash}`);
		this.name = "BlobNotFoundError";
		this.hash = hash;
	}
}

export class BlobHashMismatchError extends Error {
	readonly expectedHash: ContentHash;
	readonly actualHash: ContentHash;

	constructor(expectedHash: ContentHash, actualHash: ContentHash) {
		super(`Content hash mismatch: expected ${expectedHash}, got ${actualHash}`);
		this.name = "BlobHashMismatchError";
		this.expectedHash = expectedHash;
		this.actualHash = actualHash;
	}
}

export interface CreateMemoryBlobStorageOptions {
	readonly now?: () => number;
}

export function createMemoryBlobStorage(
	options: CreateMemoryBlobStorageOptions = {},
): BlobCache & BlobStore {
	return new MemoryBlobStorage(options);
}

export async function hashBlobBytes(bytes: BlobBytes): Promise<ContentHash> {
	const data = await readBlobBytes(bytes);
	const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
	return `sha256:${toHex(new Uint8Array(digest))}`;
}

export async function putBlobInCache(
	cache: BlobCache,
	bytes: BlobBytes,
): Promise<ContentBlobDescriptor> {
	return cache.put(bytes);
}

export async function ensureBlobInStore(
	cache: BlobCache,
	store: BlobStore,
	hash: ContentHash,
): Promise<BlobTransferResult> {
	if (await store.has(hash)) {
		const stat = await statBlob(store, hash);
		return {
			hash,
			status: "already-present",
			...(stat ? { size: stat.size } : {}),
		};
	}
	if (!(await cache.has(hash))) {
		return { hash, status: "missing" };
	}
	const bytes = await cache.get(hash);
	const descriptor = await store.put(bytes, hash);
	return { hash, status: "uploaded", size: descriptor.size };
}

export async function ensureBlobInCache(
	cache: BlobCache,
	store: BlobStore,
	hash: ContentHash,
): Promise<BlobTransferResult> {
	if (await cache.has(hash)) {
		const stat = await cache.stat(hash);
		return { hash, status: "already-present", size: stat.size };
	}
	if (!(await store.has(hash))) {
		return { hash, status: "missing" };
	}
	const bytes = await store.get(hash);
	const descriptor = await cache.put(bytes, hash);
	return { hash, status: "downloaded", size: descriptor.size };
}

export async function syncBlobsToStore(
	cache: BlobCache,
	store: BlobStore,
	hashes: readonly ContentHash[],
): Promise<readonly BlobTransferResult[]> {
	const results: BlobTransferResult[] = [];
	for (const hash of hashes) {
		results.push(await ensureBlobInStore(cache, store, hash));
	}
	return results;
}

export async function syncBlobsToCache(
	cache: BlobCache,
	store: BlobStore,
	hashes: readonly ContentHash[],
): Promise<readonly BlobTransferResult[]> {
	const results: BlobTransferResult[] = [];
	for (const hash of hashes) {
		results.push(await ensureBlobInCache(cache, store, hash));
	}
	return results;
}

export async function readBlobBytes(bytes: BlobBytes): Promise<Uint8Array> {
	if (bytes instanceof Uint8Array) {
		return copyBytes(bytes);
	}

	const reader = bytes.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			chunks.push(copyBytes(value));
			totalLength += value.byteLength;
		}
	} finally {
		reader.releaseLock();
	}

	const merged = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged;
}

class MemoryBlobStorage implements BlobCache, BlobStore {
	private readonly blobs = new Map<
		ContentHash,
		ContentBlobStat & { bytes: Uint8Array }
	>();
	private readonly now: () => number;

	constructor(options: CreateMemoryBlobStorageOptions) {
		this.now = options.now ?? Date.now;
	}

	async has(hash: ContentHash): Promise<boolean> {
		return this.blobs.has(hash);
	}

	async get(hash: ContentHash): Promise<Uint8Array> {
		const blob = this.blobs.get(hash);
		if (!blob) {
			throw new BlobNotFoundError(hash);
		}
		return copyBytes(blob.bytes);
	}

	async put(
		bytes: BlobBytes,
		expectedHash?: ContentHash,
	): Promise<ContentBlobDescriptor> {
		const data = await readBlobBytes(bytes);
		const hash = await hashBlobBytes(data);
		if (expectedHash !== undefined && hash !== expectedHash) {
			throw new BlobHashMismatchError(expectedHash, hash);
		}
		this.blobs.set(hash, {
			hash,
			size: data.byteLength,
			updatedAt: this.now(),
			bytes: data,
		});
		return { hash, size: data.byteLength };
	}

	async delete(hash: ContentHash): Promise<void> {
		this.blobs.delete(hash);
	}

	async stat(hash: ContentHash): Promise<ContentBlobStat> {
		const blob = this.blobs.get(hash);
		if (!blob) {
			throw new BlobNotFoundError(hash);
		}
		return {
			hash: blob.hash,
			size: blob.size,
			...(blob.updatedAt !== undefined ? { updatedAt: blob.updatedAt } : {}),
		};
	}
}

async function statBlob(
	store: BlobStore,
	hash: ContentHash,
): Promise<ContentBlobStat | undefined> {
	if (!store.stat) {
		return undefined;
	}
	return store.stat(hash);
}

function copyBytes(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(bytes);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

function toHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}
