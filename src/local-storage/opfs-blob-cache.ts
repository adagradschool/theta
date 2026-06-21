import {
	type BlobBytes,
	type BlobCache,
	BlobHashMismatchError,
	BlobNotFoundError,
	type ContentBlobDescriptor,
	type ContentBlobStat,
	type ContentHash,
	hashBlobBytes,
	readBlobBytes,
} from "../blob-sync.ts";
import type { CreateOpfsBlobCacheOptions } from "./types.ts";

export function createOpfsBlobCache(
	options: CreateOpfsBlobCacheOptions = {},
): BlobCache {
	return new OpfsBlobCache(options);
}

class OpfsBlobCache implements BlobCache {
	private readonly rootName: string;
	private readonly now: () => number;

	constructor(options: CreateOpfsBlobCacheOptions) {
		this.rootName = options.rootName ?? "theta-blobs";
		this.now = options.now ?? Date.now;
	}

	async has(hash: ContentHash): Promise<boolean> {
		try {
			await this.getFileHandle(hash, false);
			return true;
		} catch {
			return false;
		}
	}

	async get(hash: ContentHash): Promise<Uint8Array> {
		try {
			const handle = await this.getFileHandle(hash, false);
			return new Uint8Array(await (await handle.getFile()).arrayBuffer());
		} catch {
			throw new BlobNotFoundError(hash);
		}
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
		const handle = await this.getFileHandle(hash, true);
		const writable = await handle.createWritable();
		await writable.write(toArrayBuffer(data));
		await writable.close();
		return { hash, size: data.byteLength };
	}

	async delete(hash: ContentHash): Promise<void> {
		const directory = await this.getHashDirectory(hash, false);
		await directory.removeEntry(hashLeafName(hash));
	}

	async stat(hash: ContentHash): Promise<ContentBlobStat> {
		const handle = await this.getFileHandle(hash, false);
		const file = await handle.getFile();
		return {
			hash,
			size: file.size,
			updatedAt: this.now(),
		};
	}

	private async getFileHandle(
		hash: ContentHash,
		create: boolean,
	): Promise<FileSystemFileHandle> {
		const directory = await this.getHashDirectory(hash, create);
		return directory.getFileHandle(hashLeafName(hash), { create });
	}

	private async getHashDirectory(
		hash: ContentHash,
		create: boolean,
	): Promise<FileSystemDirectoryHandle> {
		const root = await navigator.storage.getDirectory();
		const theta = await root.getDirectoryHandle(this.rootName, { create });
		const [algorithm, digest] = splitHash(hash);
		const algorithmDirectory = await theta.getDirectoryHandle(algorithm, {
			create,
		});
		const prefix = digest.slice(0, 2);
		return algorithmDirectory.getDirectoryHandle(prefix, { create });
	}
}

function splitHash(hash: ContentHash): readonly [string, string] {
	const [algorithm, digest] = hash.split(":");
	if (!algorithm || !digest) {
		throw new BlobNotFoundError(hash);
	}
	return [algorithm, digest];
}

function hashLeafName(hash: ContentHash): string {
	return splitHash(hash)[1];
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}
