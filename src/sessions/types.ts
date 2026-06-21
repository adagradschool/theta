import type { JsonObject, JsonValue } from "../json.ts";
import type { PGliteInterface } from "@electric-sql/pglite";
import type { PGliteWorkspaceMetadataStore } from "../local-storage/types.ts";
import type { ThetaMessage } from "../messages.ts";
import type { ThetaModelRef, ThetaThinkingLevel } from "../model.ts";

export type ThetaSessionEntryKind =
	| "message"
	| "modelChange"
	| "thinkingLevelChange"
	| "compaction"
	| "custom";

export interface ThetaSessionRecord {
	readonly id: string;
	readonly workspaceId?: string;
	readonly title: string;
	readonly rootBranchId: string;
	readonly activeBranchId: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly metadata?: JsonObject;
}

export interface ThetaSessionBranch {
	readonly id: string;
	readonly sessionId: string;
	readonly parentBranchId?: string;
	readonly parentEntryId?: string;
	readonly title?: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly metadata?: JsonObject;
}

export interface ThetaSessionEntryBase {
	readonly id: string;
	readonly sessionId: string;
	readonly branchId: string;
	readonly parentEntryId?: string;
	readonly createdAt: number;
	readonly metadata?: JsonObject;
}

export interface ThetaSessionMessageEntry extends ThetaSessionEntryBase {
	readonly kind: "message";
	readonly message: ThetaMessage;
}

export interface ThetaSessionModelChangeEntry extends ThetaSessionEntryBase {
	readonly kind: "modelChange";
	readonly model?: ThetaModelRef;
}

export interface ThetaSessionThinkingLevelChangeEntry
	extends ThetaSessionEntryBase {
	readonly kind: "thinkingLevelChange";
	readonly thinkingLevel: ThetaThinkingLevel;
}

export interface ThetaSessionCompactionEntry extends ThetaSessionEntryBase {
	readonly kind: "compaction";
	readonly summary: string;
	readonly firstKeptEntryId: string;
	readonly tokensBefore: number;
	readonly details?: JsonObject;
}

export interface ThetaSessionCustomEntry extends ThetaSessionEntryBase {
	readonly kind: "custom";
	readonly customType: string;
	readonly data: JsonValue;
	readonly display: boolean;
}

export type ThetaSessionEntry =
	| ThetaSessionMessageEntry
	| ThetaSessionModelChangeEntry
	| ThetaSessionThinkingLevelChangeEntry
	| ThetaSessionCompactionEntry
	| ThetaSessionCustomEntry;

export interface ThetaSessionSnapshot {
	readonly session: ThetaSessionRecord;
	readonly branches: readonly ThetaSessionBranch[];
	readonly entries: readonly ThetaSessionEntry[];
}

export interface ThetaSessionRestore {
	readonly session: ThetaSessionRecord;
	readonly branch: ThetaSessionBranch;
	readonly entries: readonly ThetaSessionEntry[];
	readonly messages: readonly ThetaMessage[];
	readonly model?: ThetaModelRef;
	readonly thinkingLevel: ThetaThinkingLevel;
}

export interface ThetaSessionBranchNode {
	readonly branch: ThetaSessionBranch;
	readonly children: readonly ThetaSessionBranchNode[];
}

export interface ThetaSessionStore {
	list(): Promise<readonly ThetaSessionSnapshot[]>;
	get(sessionId: string): Promise<ThetaSessionSnapshot | undefined>;
	put(snapshot: ThetaSessionSnapshot): Promise<void>;
	delete(sessionId: string): Promise<void>;
}

export interface CreateThetaSessionOptions {
	readonly id?: string;
	readonly workspaceId?: string;
	readonly title?: string;
	readonly metadata?: JsonObject;
}

export interface ForkThetaSessionBranchOptions {
	readonly id?: string;
	readonly fromBranchId?: string;
	readonly afterEntryId?: string;
	readonly title?: string;
	readonly metadata?: JsonObject;
	readonly activate?: boolean;
}

export interface AppendThetaSessionEntryOptions {
	readonly id?: string;
	readonly branchId?: string;
	readonly parentEntryId?: string;
	readonly metadata?: JsonObject;
}

export interface AppendThetaSessionCustomEntryOptions
	extends AppendThetaSessionEntryOptions {
	readonly customType: string;
	readonly data: JsonValue;
	readonly display?: boolean;
}

export interface AppendThetaSessionCompactionEntryOptions
	extends AppendThetaSessionEntryOptions {
	readonly summary: string;
	readonly firstKeptEntryId: string;
	readonly tokensBefore: number;
	readonly details?: JsonObject;
}

export interface CreateThetaSessionManagerOptions {
	readonly store?: ThetaSessionStore;
	readonly now?: () => number;
	readonly createId?: () => string;
}

export interface CreatePGliteThetaSessionStoreOptions {
	readonly pg: Pick<PGliteInterface, "query" | "exec">;
	readonly metadata: PGliteWorkspaceMetadataStore;
	readonly now?: () => number;
}

export interface ThetaSessionManager {
	createSession(
		options?: CreateThetaSessionOptions,
	): Promise<ThetaSessionSnapshot>;
	listSessions(): Promise<readonly ThetaSessionRecord[]>;
	getSession(sessionId: string): Promise<ThetaSessionSnapshot | undefined>;
	deleteSession(sessionId: string): Promise<void>;
	appendMessage(
		sessionId: string,
		message: ThetaMessage,
		options?: AppendThetaSessionEntryOptions,
	): Promise<ThetaSessionMessageEntry>;
	appendModelChange(
		sessionId: string,
		model: ThetaModelRef | undefined,
		options?: AppendThetaSessionEntryOptions,
	): Promise<ThetaSessionModelChangeEntry>;
	appendThinkingLevelChange(
		sessionId: string,
		thinkingLevel: ThetaThinkingLevel,
		options?: AppendThetaSessionEntryOptions,
	): Promise<ThetaSessionThinkingLevelChangeEntry>;
	appendCompactionEntry(
		sessionId: string,
		options: AppendThetaSessionCompactionEntryOptions,
	): Promise<ThetaSessionCompactionEntry>;
	appendCustomEntry(
		sessionId: string,
		options: AppendThetaSessionCustomEntryOptions,
	): Promise<ThetaSessionCustomEntry>;
	forkBranch(
		sessionId: string,
		options?: ForkThetaSessionBranchOptions,
	): Promise<ThetaSessionBranch>;
	setActiveBranch(
		sessionId: string,
		branchId: string,
	): Promise<ThetaSessionRecord>;
	restore(
		sessionId: string,
		branchId?: string,
	): Promise<ThetaSessionRestore | undefined>;
	getSessionTree(
		sessionId: string,
	): Promise<ThetaSessionBranchNode | undefined>;
}
