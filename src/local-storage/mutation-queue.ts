import type { PGliteInterface } from "@electric-sql/pglite";
import { THETA_LOCAL_STORAGE_SCHEMA_VERSION } from "./constants.ts";
import type {
	PGliteWorkspaceMetadataStore,
	ThetaWorkspaceMutationPayload,
	ThetaWorkspaceMutationQueue,
	ThetaWorkspaceMutationRecord,
} from "./types.ts";

export interface CreatePGliteWorkspaceMutationQueueOptions {
	readonly pg: Pick<PGliteInterface, "query" | "exec">;
	readonly metadata: PGliteWorkspaceMetadataStore;
	readonly now?: () => number;
	readonly createId?: () => string;
}

export function createPGliteWorkspaceMutationQueue(
	options: CreatePGliteWorkspaceMutationQueueOptions,
): ThetaWorkspaceMutationQueue {
	return new PGliteWorkspaceMutationQueue(options);
}

class PGliteWorkspaceMutationQueue implements ThetaWorkspaceMutationQueue {
	private readonly pg: Pick<PGliteInterface, "query" | "exec">;
	private readonly metadata: PGliteWorkspaceMetadataStore;
	private readonly now: () => number;
	private readonly createId: () => string;

	constructor(options: CreatePGliteWorkspaceMutationQueueOptions) {
		this.pg = options.pg;
		this.metadata = options.metadata;
		this.now = options.now ?? Date.now;
		this.createId = options.createId ?? createMutationId;
	}

	async enqueue(
		mutations: readonly ThetaWorkspaceMutationPayload[],
	): Promise<readonly ThetaWorkspaceMutationRecord[]> {
		await this.metadata.migrate(THETA_LOCAL_STORAGE_SCHEMA_VERSION);
		const records = mutations.map((payload) => {
			const timestamp = this.now();
			return {
				id: this.createId(),
				workspaceId: workspaceIdFromPayload(payload),
				kind: payload.kind,
				payload,
				attempts: 0,
				createdAt: timestamp,
				updatedAt: timestamp,
			};
		});
		if (records.length === 0) {
			return [];
		}
		await this.pg.exec("begin");
		try {
			for (const record of records) {
				await this.pg.query(
					`insert into theta_workspace_mutation_queue (
  id, workspace_id, kind, payload_json, attempts, created_at, updated_at
) values ($1,$2,$3,$4,0,$5,$6)`,
					[
						record.id,
						record.workspaceId,
						record.kind,
						JSON.stringify(record.payload),
						record.createdAt,
						record.updatedAt,
					],
				);
			}
			await this.pg.exec("commit");
		} catch (error) {
			await this.pg.exec("rollback");
			throw error;
		}
		return records;
	}

	async listPending(
		workspaceId: string,
		limit = 100,
	): Promise<readonly ThetaWorkspaceMutationRecord[]> {
		await this.metadata.migrate(THETA_LOCAL_STORAGE_SCHEMA_VERSION);
		const result = await this.pg.query<MutationQueueRow>(
			`select *
from theta_workspace_mutation_queue
where workspace_id = $1
order by created_at asc
limit $2`,
			[workspaceId, limit],
		);
		return result.rows.map(rowToMutationRecord);
	}

	async markSynced(ids: readonly string[]): Promise<void> {
		if (ids.length === 0) {
			return;
		}
		await this.metadata.migrate(THETA_LOCAL_STORAGE_SCHEMA_VERSION);
		await this.pg.query(
			`delete from theta_workspace_mutation_queue
where id = any($1::text[])`,
			[ids],
		);
	}

	async markFailed(id: string, error: string): Promise<void> {
		await this.metadata.migrate(THETA_LOCAL_STORAGE_SCHEMA_VERSION);
		await this.pg.query(
			`update theta_workspace_mutation_queue
set attempts = attempts + 1,
  last_error = $2,
  updated_at = $3
where id = $1`,
			[id, error, this.now()],
		);
	}
}

interface MutationQueueRow {
	readonly id: string;
	readonly workspace_id: string;
	readonly kind: ThetaWorkspaceMutationPayload["kind"];
	readonly payload_json: string;
	readonly attempts: number | string;
	readonly last_error: string | null;
	readonly created_at: number | string;
	readonly updated_at: number | string;
}

function rowToMutationRecord(
	row: MutationQueueRow,
): ThetaWorkspaceMutationRecord {
	return {
		id: row.id,
		workspaceId: row.workspace_id,
		kind: row.kind,
		payload: JSON.parse(row.payload_json) as ThetaWorkspaceMutationPayload,
		attempts: numberFromPg(row.attempts),
		...(row.last_error !== null ? { lastError: row.last_error } : {}),
		createdAt: numberFromPg(row.created_at),
		updatedAt: numberFromPg(row.updated_at),
	};
}

function workspaceIdFromPayload(
	payload: ThetaWorkspaceMutationPayload,
): string {
	switch (payload.kind) {
		case "putEntry":
			return payload.entry.workspaceId;
		case "recordFileVersion":
			return payload.version.workspaceId;
		case "deleteEntry":
			return payload.workspaceId;
	}
}

function numberFromPg(value: number | string): number {
	return typeof value === "number" ? value : Number.parseInt(value, 10);
}

let nextMutationId = 1;

function createMutationId(): string {
	const id = `theta-mut-${Date.now()}-${nextMutationId}`;
	nextMutationId += 1;
	return id;
}
