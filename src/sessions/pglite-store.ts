import type { PGliteInterface } from "@electric-sql/pglite";
import type { JsonObject, JsonValue } from "../core/json.ts";
import { THETA_LOCAL_STORAGE_SCHEMA_VERSION } from "../local-storage/constants.ts";
import type { PGliteWorkspaceMetadataStore } from "../local-storage/types.ts";
import type { ThetaMessage } from "../core/messages.ts";
import type { ThetaModelRef, ThetaThinkingLevel } from "../core/model.ts";
import type {
	CreatePGliteThetaSessionStoreOptions,
	ThetaSessionBranch,
	ThetaSessionCompactionEntry,
	ThetaSessionEntry,
	ThetaSessionEntryKind,
	ThetaSessionRecord,
	ThetaSessionSnapshot,
	ThetaSessionStore,
} from "./types.ts";

export function createPGliteThetaSessionStore(
	options: CreatePGliteThetaSessionStoreOptions,
): ThetaSessionStore {
	return new PGliteThetaSessionStore(options);
}

class PGliteThetaSessionStore implements ThetaSessionStore {
	private readonly pg: Pick<PGliteInterface, "query" | "exec">;
	private readonly metadata: PGliteWorkspaceMetadataStore;
	private readonly now: () => number;

	constructor(options: CreatePGliteThetaSessionStoreOptions) {
		this.pg = options.pg;
		this.metadata = options.metadata;
		this.now = options.now ?? Date.now;
	}

	async list(): Promise<readonly ThetaSessionSnapshot[]> {
		await this.migrate();
		const result = await this.pg.query<SessionRow>(
			`select * from theta_sessions
where deleted_at is null
order by updated_at desc, id asc`,
		);
		const snapshots: ThetaSessionSnapshot[] = [];
		for (const row of result.rows) {
			const snapshot = await this.get(row.id);
			if (snapshot) {
				snapshots.push(snapshot);
			}
		}
		return snapshots;
	}

	async get(sessionId: string): Promise<ThetaSessionSnapshot | undefined> {
		await this.migrate();
		const sessionResult = await this.pg.query<SessionRow>(
			`select * from theta_sessions
where id = $1 and deleted_at is null`,
			[sessionId],
		);
		const sessionRow = sessionResult.rows[0];
		if (!sessionRow) {
			return undefined;
		}
		const branchResult = await this.pg.query<BranchRow>(
			`select * from theta_session_branches
where session_id = $1
order by created_at asc, id asc`,
			[sessionId],
		);
		const entryResult = await this.pg.query<EntryRow>(
			`select * from theta_session_entries
where session_id = $1
order by created_at asc, id asc`,
			[sessionId],
		);
		return {
			session: rowToSession(sessionRow),
			branches: branchResult.rows.map(rowToBranch),
			entries: entryResult.rows.map(rowToEntry),
		};
	}

	async put(snapshot: ThetaSessionSnapshot): Promise<void> {
		await this.migrate();
		await this.pg.exec("begin");
		try {
			await this.pg.query(
				`insert into theta_sessions (
  id, workspace_id, title, root_branch_id, active_branch_id, metadata_json,
  created_at, updated_at, deleted_at
) values ($1,$2,$3,$4,$5,$6,$7,$8,null)
on conflict (id) do update set
  workspace_id = excluded.workspace_id,
  title = excluded.title,
  root_branch_id = excluded.root_branch_id,
  active_branch_id = excluded.active_branch_id,
  metadata_json = excluded.metadata_json,
  updated_at = excluded.updated_at,
  deleted_at = null`,
				sessionParams(snapshot.session),
			);
			await this.pg.query(
				"delete from theta_session_entries where session_id = $1",
				[snapshot.session.id],
			);
			await this.pg.query(
				"delete from theta_session_branches where session_id = $1",
				[snapshot.session.id],
			);
			for (const branch of snapshot.branches) {
				await this.pg.query(
					`insert into theta_session_branches (
  id, session_id, parent_branch_id, parent_entry_id, title, metadata_json,
  created_at, updated_at
) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
					branchParams(branch),
				);
			}
			for (const entry of snapshot.entries) {
				await this.pg.query(
					`insert into theta_session_entries (
  id, session_id, branch_id, parent_entry_id, kind, payload_json,
  metadata_json, created_at
) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
					entryParams(entry),
				);
			}
			await this.pg.exec("commit");
		} catch (error) {
			await this.pg.exec("rollback");
			throw error;
		}
	}

	async delete(sessionId: string): Promise<void> {
		await this.migrate();
		const timestamp = this.now();
		await this.pg.query(
			`update theta_sessions
set deleted_at = $2, updated_at = $2
where id = $1`,
			[sessionId, timestamp],
		);
	}

	private async migrate(): Promise<void> {
		await this.metadata.migrate(THETA_LOCAL_STORAGE_SCHEMA_VERSION);
	}
}

interface SessionRow {
	readonly id: string;
	readonly workspace_id: string | null;
	readonly title: string;
	readonly root_branch_id: string;
	readonly active_branch_id: string;
	readonly metadata_json: string | null;
	readonly created_at: number | string;
	readonly updated_at: number | string;
}

interface BranchRow {
	readonly id: string;
	readonly session_id: string;
	readonly parent_branch_id: string | null;
	readonly parent_entry_id: string | null;
	readonly title: string | null;
	readonly metadata_json: string | null;
	readonly created_at: number | string;
	readonly updated_at: number | string;
}

interface EntryRow {
	readonly id: string;
	readonly session_id: string;
	readonly branch_id: string;
	readonly parent_entry_id: string | null;
	readonly kind: ThetaSessionEntryKind;
	readonly payload_json: string;
	readonly metadata_json: string | null;
	readonly created_at: number | string;
}

function rowToSession(row: SessionRow): ThetaSessionRecord {
	return withOptional(
		{
			id: row.id,
			title: row.title,
			rootBranchId: row.root_branch_id,
			activeBranchId: row.active_branch_id,
			createdAt: numberFromPg(row.created_at),
			updatedAt: numberFromPg(row.updated_at),
		},
		{
			workspaceId: row.workspace_id ?? undefined,
			metadata: parseObject(row.metadata_json),
		},
	);
}

function rowToBranch(row: BranchRow): ThetaSessionBranch {
	return withOptional(
		{
			id: row.id,
			sessionId: row.session_id,
			createdAt: numberFromPg(row.created_at),
			updatedAt: numberFromPg(row.updated_at),
		},
		{
			parentBranchId: row.parent_branch_id ?? undefined,
			parentEntryId: row.parent_entry_id ?? undefined,
			title: row.title ?? undefined,
			metadata: parseObject(row.metadata_json),
		},
	);
}

function rowToEntry(row: EntryRow): ThetaSessionEntry {
	const base = withOptional(
		{
			id: row.id,
			sessionId: row.session_id,
			branchId: row.branch_id,
			createdAt: numberFromPg(row.created_at),
		},
		{
			parentEntryId: row.parent_entry_id ?? undefined,
			metadata: parseObject(row.metadata_json),
		},
	);
	const payload = parseObject(row.payload_json) ?? {};
	if (row.kind === "message") {
		return {
			...base,
			kind: "message",
			message: payload.message as unknown as ThetaMessage,
		};
	}
	if (row.kind === "modelChange") {
		return withOptional(
			{
				...base,
				kind: "modelChange",
			},
			{ model: payload.model as ThetaModelRef | undefined },
		);
	}
	if (row.kind === "thinkingLevelChange") {
		return {
			...base,
			kind: "thinkingLevelChange",
			thinkingLevel: payload.thinkingLevel as ThetaThinkingLevel,
		};
	}
	if (row.kind === "compaction") {
		return withOptional(
			{
				...base,
				kind: "compaction",
				summary: String(payload.summary ?? ""),
				firstKeptEntryId: String(payload.firstKeptEntryId ?? ""),
				tokensBefore: Number(payload.tokensBefore ?? 0),
			} satisfies ThetaSessionCompactionEntry,
			{ details: parsePayloadObject(payload.details) },
		);
	}
	return {
		...base,
		kind: "custom",
		customType: String(payload.customType),
		data: payload.data ?? null,
		display: payload.display !== false,
	};
}

function sessionParams(session: ThetaSessionRecord): unknown[] {
	return [
		session.id,
		session.workspaceId ?? null,
		session.title,
		session.rootBranchId,
		session.activeBranchId,
		stringifyOptional(session.metadata),
		session.createdAt,
		session.updatedAt,
	];
}

function branchParams(branch: ThetaSessionBranch): unknown[] {
	return [
		branch.id,
		branch.sessionId,
		branch.parentBranchId ?? null,
		branch.parentEntryId ?? null,
		branch.title ?? null,
		stringifyOptional(branch.metadata),
		branch.createdAt,
		branch.updatedAt,
	];
}

function entryParams(entry: ThetaSessionEntry): unknown[] {
	return [
		entry.id,
		entry.sessionId,
		entry.branchId,
		entry.parentEntryId ?? null,
		entry.kind,
		JSON.stringify(entryPayload(entry)),
		stringifyOptional(entry.metadata),
		entry.createdAt,
	];
}

function entryPayload(entry: ThetaSessionEntry): JsonObject {
	if (entry.kind === "message") {
		return { message: entry.message as unknown as JsonValue };
	}
	if (entry.kind === "modelChange") {
		return entry.model === undefined
			? {}
			: { model: entry.model as unknown as JsonValue };
	}
	if (entry.kind === "thinkingLevelChange") {
		return { thinkingLevel: entry.thinkingLevel };
	}
	if (entry.kind === "compaction") {
		return {
			summary: entry.summary,
			firstKeptEntryId: entry.firstKeptEntryId,
			tokensBefore: entry.tokensBefore,
			...(entry.details !== undefined ? { details: entry.details } : {}),
		};
	}
	return {
		customType: entry.customType,
		data: entry.data,
		display: entry.display,
	};
}

function parsePayloadObject(
	value: JsonValue | undefined,
): JsonObject | undefined {
	return value !== undefined &&
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value)
		? (value as JsonObject)
		: undefined;
}

function parseObject(json: string | null): JsonObject | undefined {
	if (json === null) {
		return undefined;
	}
	const parsed = JSON.parse(json) as JsonValue;
	return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as JsonObject)
		: undefined;
}

function stringifyOptional(value: JsonObject | undefined): string | null {
	return value === undefined ? null : JSON.stringify(value);
}

function numberFromPg(value: number | string): number {
	return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function withOptional<T extends object>(
	base: T,
	optionals: {
		readonly [key: string]: unknown;
	},
): T {
	const copy = Object.assign({}, base) as Record<string, unknown>;
	for (const [key, value] of Object.entries(optionals)) {
		if (value !== undefined) {
			copy[key] = value;
		}
	}
	return copy as T;
}
