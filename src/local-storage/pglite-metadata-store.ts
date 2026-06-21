import type { PGliteInterface } from "@electric-sql/pglite";
import {
	WorkspaceAlreadyExistsError,
	WorkspaceConflictError,
	normalizeWorkspacePath,
} from "../filesystem.ts";
import {
	THETA_LOCAL_STORAGE_MIGRATIONS,
	THETA_LOCAL_STORAGE_SCHEMA_VERSION,
} from "./constants.ts";
import { makeEntry, numberFromPg, parseMetadata } from "./record-utils.ts";
import type {
	LocalWorkspaceEntryKind,
	LocalWorkspaceEntryRecord,
	LocalWorkspaceFileVersionRecord,
	PGliteWorkspaceMetadataStore,
	PutLocalWorkspaceEntryOptions,
} from "./types.ts";
import type { ContentHash } from "../blob-sync.ts";

export function createPGliteWorkspaceMetadataStore(
	pg: Pick<PGliteInterface, "query" | "exec">,
): PGliteWorkspaceMetadataStore {
	return new PGliteWorkspaceMetadataStoreAdapter(pg);
}

class PGliteWorkspaceMetadataStoreAdapter
	implements PGliteWorkspaceMetadataStore
{
	private readonly pg: Pick<PGliteInterface, "query" | "exec">;

	constructor(pg: Pick<PGliteInterface, "query" | "exec">) {
		this.pg = pg;
	}

	async getSchemaVersion(): Promise<number> {
		await this.ensureMigrationTable();
		const result = await this.pg.query<{ version: number }>(
			"select coalesce(max(version), 0)::int as version from theta_schema_migrations",
		);
		return result.rows[0]?.version ?? 0;
	}

	async migrate(
		targetVersion = THETA_LOCAL_STORAGE_SCHEMA_VERSION,
	): Promise<void> {
		await this.ensureMigrationTable();
		const current = await this.getSchemaVersion();
		if (targetVersion < current) {
			throw new Error(
				`Cannot migrate local workspace schema from ${current} down to ${targetVersion}.`,
			);
		}
		for (const migration of THETA_LOCAL_STORAGE_MIGRATIONS) {
			if (migration.version <= current || migration.version > targetVersion) {
				continue;
			}
			await this.pg.exec("begin");
			try {
				for (const statement of migration.sql) {
					await this.pg.exec(statement);
				}
				await this.pg.query(
					`insert into theta_schema_migrations (version, description, applied_at)
values ($1, $2, $3)
on conflict (version) do nothing`,
					[migration.version, migration.description, Date.now()],
				);
				await this.pg.exec("commit");
			} catch (error) {
				await this.pg.exec("rollback");
				throw error;
			}
		}
	}

	async getEntry(
		workspaceId: string,
		path: string,
	): Promise<LocalWorkspaceEntryRecord | undefined> {
		await this.migrate();
		return this.getEntryWithoutMigrating(workspaceId, path);
	}

	async listChildren(
		workspaceId: string,
		directoryPath: string,
	): Promise<readonly LocalWorkspaceEntryRecord[]> {
		await this.migrate();
		const result = await this.pg.query<PGliteEntryRow>(
			`select * from theta_workspace_entries
where workspace_id = $1 and parent_path = $2 and deleted_at is null
order by path asc`,
			[workspaceId, normalizeWorkspacePath(directoryPath)],
		);
		return result.rows.map(rowToEntry);
	}

	async putEntry(
		entry: LocalWorkspaceEntryRecord,
		options: PutLocalWorkspaceEntryOptions = {},
	): Promise<void> {
		await this.migrate();
		await this.pg.exec("begin");
		try {
			const existing = await this.getEntryWithoutMigrating(
				entry.workspaceId,
				entry.path,
			);
			if (existing && options.overwrite === false) {
				throw new WorkspaceAlreadyExistsError(entry.path);
			}
			if (
				existing &&
				options.expectedVersion !== undefined &&
				existing.version !== options.expectedVersion
			) {
				throw new WorkspaceConflictError(
					entry.path,
					`Expected version ${options.expectedVersion} for ${entry.path}, found ${existing.version}.`,
				);
			}
			await this.pg.query(
				`insert into theta_workspace_entries (
  workspace_id, path, parent_path, name, kind, version, size, content_hash,
  mime_type, metadata_json, created_at, updated_at, deleted_at
) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
on conflict (workspace_id, path) do update set
  parent_path = excluded.parent_path,
  name = excluded.name,
  kind = excluded.kind,
  version = excluded.version,
  size = excluded.size,
  content_hash = excluded.content_hash,
  mime_type = excluded.mime_type,
  metadata_json = excluded.metadata_json,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at`,
				entryParams(entry),
			);
			await this.pg.exec("commit");
		} catch (error) {
			await this.pg.exec("rollback");
			throw error;
		}
	}

	async deleteEntry(workspaceId: string, path: string): Promise<void> {
		await this.migrate();
		await this.pg.query(
			`update theta_workspace_entries
set deleted_at = $3, updated_at = $3
where workspace_id = $1 and path = $2`,
			[workspaceId, normalizeWorkspacePath(path), Date.now()],
		);
	}

	async recordFileVersion(
		version: LocalWorkspaceFileVersionRecord,
	): Promise<void> {
		await this.migrate();
		await this.pg.query(
			`insert into theta_file_versions (
  workspace_id, path, version, content_hash, size, created_at
) values ($1,$2,$3,$4,$5,$6)
on conflict (workspace_id, path, version) do nothing`,
			[
				version.workspaceId,
				normalizeWorkspacePath(version.path),
				version.version,
				version.contentHash,
				version.size,
				version.createdAt,
			],
		);
	}

	async listFileVersions(
		workspaceId: string,
		path: string,
	): Promise<readonly LocalWorkspaceFileVersionRecord[]> {
		await this.migrate();
		const result = await this.pg.query<PGliteVersionRow>(
			`select * from theta_file_versions
where workspace_id = $1 and path = $2
order by created_at asc`,
			[workspaceId, normalizeWorkspacePath(path)],
		);
		return result.rows.map((row) => ({
			workspaceId: row.workspace_id,
			path: row.path,
			version: row.version,
			contentHash: row.content_hash,
			size: numberFromPg(row.size),
			createdAt: numberFromPg(row.created_at),
		}));
	}

	private async ensureMigrationTable(): Promise<void> {
		await this.pg.exec(THETA_LOCAL_STORAGE_MIGRATIONS[0]?.sql[0] ?? "");
	}

	private async getEntryWithoutMigrating(
		workspaceId: string,
		path: string,
	): Promise<LocalWorkspaceEntryRecord | undefined> {
		const result = await this.pg.query<PGliteEntryRow>(
			`select * from theta_workspace_entries
where workspace_id = $1 and path = $2 and deleted_at is null`,
			[workspaceId, normalizeWorkspacePath(path)],
		);
		const row = result.rows[0];
		return row ? rowToEntry(row) : undefined;
	}
}

interface PGliteEntryRow {
	readonly workspace_id: string;
	readonly path: string;
	readonly kind: LocalWorkspaceEntryKind;
	readonly version: string;
	readonly size: number | string;
	readonly content_hash: ContentHash | null;
	readonly mime_type: string | null;
	readonly metadata_json: string | null;
	readonly created_at: number | string;
	readonly updated_at: number | string;
	readonly deleted_at: number | string | null;
}

interface PGliteVersionRow {
	readonly workspace_id: string;
	readonly path: string;
	readonly version: string;
	readonly content_hash: ContentHash;
	readonly size: number | string;
	readonly created_at: number | string;
}

function rowToEntry(row: PGliteEntryRow): LocalWorkspaceEntryRecord {
	const metadata = parseMetadata(row.metadata_json);
	return makeEntry({
		workspaceId: row.workspace_id,
		path: row.path,
		kind: row.kind,
		version: row.version,
		size: numberFromPg(row.size),
		createdAt: numberFromPg(row.created_at),
		updatedAt: numberFromPg(row.updated_at),
		...(row.content_hash !== null ? { contentHash: row.content_hash } : {}),
		...(row.mime_type !== null ? { mimeType: row.mime_type } : {}),
		...(metadata !== undefined ? { metadata } : {}),
		...(row.deleted_at !== null
			? { deletedAt: numberFromPg(row.deleted_at) }
			: {}),
	});
}

function entryParams(entry: LocalWorkspaceEntryRecord): unknown[] {
	return [
		entry.workspaceId,
		entry.path,
		entry.parentPath,
		entry.name,
		entry.kind,
		entry.version,
		entry.size,
		entry.contentHash ?? null,
		entry.mimeType ?? null,
		entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
		entry.createdAt,
		entry.updatedAt,
		entry.deletedAt ?? null,
	];
}
