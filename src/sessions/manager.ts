import type {
	ThetaCompactionSummaryMessage,
	ThetaMessage,
} from "../messages.ts";
import type { ThetaModelRef, ThetaThinkingLevel } from "../model.ts";
import { createMemoryThetaSessionStore } from "./store.ts";
import type {
	AppendThetaSessionCustomEntryOptions,
	AppendThetaSessionCompactionEntryOptions,
	AppendThetaSessionEntryOptions,
	CreateThetaSessionManagerOptions,
	CreateThetaSessionOptions,
	ForkThetaSessionBranchOptions,
	ThetaSessionBranch,
	ThetaSessionBranchNode,
	ThetaSessionCompactionEntry,
	ThetaSessionCustomEntry,
	ThetaSessionEntry,
	ThetaSessionEntryBase,
	ThetaSessionManager,
	ThetaSessionMessageEntry,
	ThetaSessionModelChangeEntry,
	ThetaSessionRecord,
	ThetaSessionRestore,
	ThetaSessionSnapshot,
	ThetaSessionThinkingLevelChangeEntry,
	ThetaSessionStore,
} from "./types.ts";

export function createThetaSessionManager(
	options: CreateThetaSessionManagerOptions = {},
): ThetaSessionManager {
	return new ThetaSessionManagerController(options);
}

class ThetaSessionManagerController implements ThetaSessionManager {
	private readonly store: ThetaSessionStore;
	private readonly now: () => number;
	private readonly createId: () => string;

	constructor(options: CreateThetaSessionManagerOptions) {
		this.store = options.store ?? createMemoryThetaSessionStore();
		this.now = options.now ?? Date.now;
		this.createId = options.createId ?? createDefaultIdFactory();
	}

	async createSession(
		options: CreateThetaSessionOptions = {},
	): Promise<ThetaSessionSnapshot> {
		const timestamp = this.now();
		const sessionId = options.id ?? this.createId();
		const rootBranchId = this.createId();
		const session = withOptional(
			{
				id: sessionId,
				title: options.title ?? "New session",
				rootBranchId,
				activeBranchId: rootBranchId,
				createdAt: timestamp,
				updatedAt: timestamp,
			} satisfies ThetaSessionRecord,
			{
				workspaceId: options.workspaceId,
				metadata: options.metadata,
			},
		);
		const branch = withOptional(
			{
				id: rootBranchId,
				sessionId,
				createdAt: timestamp,
				updatedAt: timestamp,
			} satisfies ThetaSessionBranch,
			{},
		);
		const snapshot = { session, branches: [branch], entries: [] };
		await this.store.put(snapshot);
		return snapshot;
	}

	async listSessions(): Promise<readonly ThetaSessionRecord[]> {
		return (await this.store.list())
			.map((snapshot) => snapshot.session)
			.sort((left, right) => right.updatedAt - left.updatedAt);
	}

	async getSession(
		sessionId: string,
	): Promise<ThetaSessionSnapshot | undefined> {
		return this.store.get(sessionId);
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.store.delete(sessionId);
	}

	async appendMessage(
		sessionId: string,
		message: ThetaMessage,
		options: AppendThetaSessionEntryOptions = {},
	): Promise<ThetaSessionMessageEntry> {
		return this.appendEntry(sessionId, options, (base) => ({
			...base,
			kind: "message",
			message,
		}));
	}

	async appendModelChange(
		sessionId: string,
		model: ThetaModelRef | undefined,
		options: AppendThetaSessionEntryOptions = {},
	): Promise<ThetaSessionModelChangeEntry> {
		return this.appendEntry(sessionId, options, (base) =>
			withOptional(
				{
					...base,
					kind: "modelChange",
				},
				{ model },
			),
		);
	}

	async appendThinkingLevelChange(
		sessionId: string,
		thinkingLevel: ThetaThinkingLevel,
		options: AppendThetaSessionEntryOptions = {},
	): Promise<ThetaSessionThinkingLevelChangeEntry> {
		return this.appendEntry(sessionId, options, (base) => ({
			...base,
			kind: "thinkingLevelChange",
			thinkingLevel,
		}));
	}

	async appendCompactionEntry(
		sessionId: string,
		options: AppendThetaSessionCompactionEntryOptions,
	): Promise<ThetaSessionCompactionEntry> {
		return this.appendEntry(sessionId, options, (base) =>
			withOptional(
				{
					...base,
					kind: "compaction",
					summary: options.summary,
					firstKeptEntryId: options.firstKeptEntryId,
					tokensBefore: options.tokensBefore,
				},
				{ details: options.details },
			),
		);
	}

	async appendCustomEntry(
		sessionId: string,
		options: AppendThetaSessionCustomEntryOptions,
	): Promise<ThetaSessionCustomEntry> {
		return this.appendEntry(sessionId, options, (base) => ({
			...base,
			kind: "custom",
			customType: options.customType,
			data: options.data,
			display: options.display ?? true,
		}));
	}

	async forkBranch(
		sessionId: string,
		options: ForkThetaSessionBranchOptions = {},
	): Promise<ThetaSessionBranch> {
		const snapshot = await this.requireSnapshot(sessionId);
		const sourceBranchId =
			options.fromBranchId ?? snapshot.session.activeBranchId;
		const sourceBranch = requireBranch(snapshot, sourceBranchId);
		const parentEntryId =
			options.afterEntryId ?? lastEntry(snapshot.entries, sourceBranchId)?.id;
		if (
			parentEntryId !== undefined &&
			!snapshot.entries.some((entry) => entry.id === parentEntryId)
		) {
			throw new Error(`Session entry not found: ${parentEntryId}`);
		}
		const timestamp = this.now();
		const branch = withOptional(
			{
				id: options.id ?? this.createId(),
				sessionId,
				parentBranchId: sourceBranch.id,
				createdAt: timestamp,
				updatedAt: timestamp,
			} satisfies ThetaSessionBranch,
			{
				parentEntryId,
				title: options.title,
				metadata: options.metadata,
			},
		);
		const session = {
			...snapshot.session,
			activeBranchId:
				options.activate === false
					? snapshot.session.activeBranchId
					: branch.id,
			updatedAt: timestamp,
		};
		await this.store.put({
			session,
			branches: [...snapshot.branches, branch],
			entries: snapshot.entries,
		});
		return branch;
	}

	async setActiveBranch(
		sessionId: string,
		branchId: string,
	): Promise<ThetaSessionRecord> {
		const snapshot = await this.requireSnapshot(sessionId);
		requireBranch(snapshot, branchId);
		const session = {
			...snapshot.session,
			activeBranchId: branchId,
			updatedAt: this.now(),
		};
		await this.store.put({ ...snapshot, session });
		return session;
	}

	async restore(
		sessionId: string,
		branchId?: string,
	): Promise<ThetaSessionRestore | undefined> {
		const snapshot = await this.store.get(sessionId);
		if (!snapshot) {
			return undefined;
		}
		const targetBranchId = branchId ?? snapshot.session.activeBranchId;
		const branch = requireBranch(snapshot, targetBranchId);
		const entries = applyCompactions(
			entriesForBranch(snapshot, targetBranchId),
		);
		let model: ThetaModelRef | undefined;
		let thinkingLevel: ThetaThinkingLevel = "off";
		const messages: ThetaMessage[] = [];
		for (const entry of entries) {
			if (entry.kind === "message") {
				messages.push(entry.message);
			} else if (entry.kind === "compaction") {
				messages.push(compactionEntryToMessage(entry));
			} else if (entry.kind === "modelChange") {
				model = entry.model;
			} else if (entry.kind === "thinkingLevelChange") {
				thinkingLevel = entry.thinkingLevel;
			}
		}
		return withOptional(
			{
				session: snapshot.session,
				branch,
				entries,
				messages,
				thinkingLevel,
			} satisfies ThetaSessionRestore,
			{ model },
		);
	}

	async getSessionTree(
		sessionId: string,
	): Promise<ThetaSessionBranchNode | undefined> {
		const snapshot = await this.store.get(sessionId);
		if (!snapshot) {
			return undefined;
		}
		const root = requireBranch(snapshot, snapshot.session.rootBranchId);
		return branchNode(root, snapshot.branches);
	}

	private async appendEntry<TEntry extends ThetaSessionEntry>(
		sessionId: string,
		options: AppendThetaSessionEntryOptions,
		create: (base: ThetaSessionEntryBase) => TEntry,
	): Promise<TEntry> {
		const snapshot = await this.requireSnapshot(sessionId);
		const branchId = options.branchId ?? snapshot.session.activeBranchId;
		const branch = requireBranch(snapshot, branchId);
		const timestamp = this.now();
		const parentEntryId =
			options.parentEntryId ?? lastEntry(snapshot.entries, branchId)?.id;
		const base = withOptional(
			{
				id: options.id ?? this.createId(),
				sessionId,
				branchId,
				createdAt: timestamp,
			},
			{
				parentEntryId,
				metadata: options.metadata,
			},
		);
		const entry = create(base);
		const branches = snapshot.branches.map((candidate) =>
			candidate.id === branch.id
				? { ...candidate, updatedAt: timestamp }
				: candidate,
		);
		await this.store.put({
			session: { ...snapshot.session, updatedAt: timestamp },
			branches,
			entries: [...snapshot.entries, entry],
		});
		return entry;
	}

	private async requireSnapshot(
		sessionId: string,
	): Promise<ThetaSessionSnapshot> {
		const snapshot = await this.store.get(sessionId);
		if (!snapshot) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		return snapshot;
	}
}

function applyCompactions(
	entries: readonly ThetaSessionEntry[],
): readonly ThetaSessionEntry[] {
	let latestCompactionIndex = -1;
	for (let index = 0; index < entries.length; index += 1) {
		if (entries[index]?.kind === "compaction") {
			latestCompactionIndex = index;
		}
	}
	if (latestCompactionIndex === -1) {
		return entries;
	}
	const compaction = entries[
		latestCompactionIndex
	] as ThetaSessionCompactionEntry;
	const firstKeptIndex = entries.findIndex(
		(entry) => entry.id === compaction.firstKeptEntryId,
	);
	if (firstKeptIndex === -1) {
		return [compaction];
	}
	return [
		compaction,
		...entries
			.slice(firstKeptIndex)
			.filter((entry) => entry.id !== compaction.id),
	];
}

function compactionEntryToMessage(
	entry: ThetaSessionCompactionEntry,
): ThetaCompactionSummaryMessage {
	return {
		role: "compactionSummary",
		summary: entry.summary,
		tokensBefore: entry.tokensBefore,
		timestamp: entry.createdAt,
	};
}

function entriesForBranch(
	snapshot: ThetaSessionSnapshot,
	branchId: string,
): readonly ThetaSessionEntry[] {
	const branch = requireBranch(snapshot, branchId);
	const entryIds = new Set<string>();
	const collectBranch = (
		current: ThetaSessionBranch,
		cutoffEntryId: string | undefined,
	): void => {
		if (current.parentBranchId) {
			collectBranch(
				requireBranch(snapshot, current.parentBranchId),
				current.parentEntryId,
			);
		}
		const cutoffCreatedAt =
			cutoffEntryId === undefined
				? Number.MAX_SAFE_INTEGER
				: entryCreatedAt(snapshot, cutoffEntryId);
		for (const entry of snapshot.entries) {
			if (entry.branchId !== current.id) {
				continue;
			}
			if (entry.createdAt <= cutoffCreatedAt) {
				entryIds.add(entry.id);
			}
		}
	};
	collectBranch(branch, undefined);
	return snapshot.entries
		.filter((entry) => entryIds.has(entry.id))
		.sort((left, right) => left.createdAt - right.createdAt);
}

function entryCreatedAt(
	snapshot: ThetaSessionSnapshot,
	entryId: string,
): number {
	return (
		snapshot.entries.find((entry) => entry.id === entryId)?.createdAt ??
		Number.MAX_SAFE_INTEGER
	);
}

function requireBranch(
	snapshot: ThetaSessionSnapshot,
	branchId: string,
): ThetaSessionBranch {
	const branch = snapshot.branches.find(
		(candidate) => candidate.id === branchId,
	);
	if (!branch) {
		throw new Error(`Session branch not found: ${branchId}`);
	}
	return branch;
}

function lastEntry(
	entries: readonly ThetaSessionEntry[],
	branchId: string,
): ThetaSessionEntry | undefined {
	return entries
		.filter((entry) => entry.branchId === branchId)
		.sort((left, right) => right.createdAt - left.createdAt)[0];
}

function branchNode(
	branch: ThetaSessionBranch,
	branches: readonly ThetaSessionBranch[],
): ThetaSessionBranchNode {
	return {
		branch,
		children: branches
			.filter((candidate) => candidate.parentBranchId === branch.id)
			.sort((left, right) => left.createdAt - right.createdAt)
			.map((child) => branchNode(child, branches)),
	};
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

function createDefaultIdFactory(): () => string {
	let next = 1;
	return () => `theta-session-${next++}`;
}
