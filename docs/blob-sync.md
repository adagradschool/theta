# Content-Addressed Blob Sync

Theta stores large file bytes separately from synced metadata.

## Roles

- `BlobCache`: local materialized byte cache. The first browser implementation should use OPFS.
- `BlobStore`: durable remote object storage. Production adapters can use S3, R2, Supabase Storage, or an app-owned blob endpoint.
- PGlite/Electric: synced metadata for paths, versions, content hashes, queue state, and conflicts.

Electric should sync blob references and status, not bulk file bytes.

## Flow

1. Write file bytes into the local `BlobCache`.
2. Compute a `sha256:{hex}` content hash.
3. Store file version metadata in PGlite.
4. Electric syncs the file version and hash to other devices.
5. Upload missing hashes from `BlobCache` to `BlobStore`.
6. Other devices download missing hashes from `BlobStore` into their local `BlobCache`.

OPFS is a cache. If it is evicted, synced metadata can identify the missing hashes and restore them from `BlobStore`.

## Adapter Contract

Adapters must verify `expectedHash` on writes. A hash mismatch means the byte stream is corrupt or the metadata points at the wrong object.

Adapters should copy byte buffers on read/write boundaries or otherwise guarantee callers cannot mutate stored content accidentally.
