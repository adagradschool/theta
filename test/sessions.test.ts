import { describe, expect, it } from "vitest";
import {
	createBrowserThetaSessionStore,
	createMemoryThetaSessionStore,
	createThetaSessionManager,
	type ThetaMessage,
} from "../src/index.ts";

function userMessage(text: string, timestamp: number): ThetaMessage {
	return { role: "user", content: text, timestamp };
}

describe("Theta sessions", () => {
	it("appends entries and restores message, model, and thinking state", async () => {
		const manager = createThetaSessionManager({
			now: fixedClock(100, 10),
			createId: fixedIds(
				"session-a",
				"branch-root",
				"entry-1",
				"entry-2",
				"entry-3",
			),
		});
		const snapshot = await manager.createSession({
			title: "Build",
			workspaceId: "workspace-a",
		});

		await manager.appendModelChange(snapshot.session.id, {
			provider: "openai",
			id: "gpt-4.1-nano",
		});
		await manager.appendThinkingLevelChange(snapshot.session.id, "medium");
		await manager.appendMessage(snapshot.session.id, userMessage("hello", 1));

		const restored = await manager.restore(snapshot.session.id);

		expect(restored?.session).toMatchObject({
			id: "session-a",
			workspaceId: "workspace-a",
			title: "Build",
		});
		expect(restored?.messages).toEqual([userMessage("hello", 1)]);
		expect(restored?.model).toMatchObject({ id: "gpt-4.1-nano" });
		expect(restored?.thinkingLevel).toBe("medium");
	});

	it("forks branches and restores branch-specific history", async () => {
		const manager = createThetaSessionManager({
			now: fixedClock(1, 1),
			createId: fixedIds(
				"session-a",
				"root",
				"root-message",
				"fork",
				"fork-message",
				"root-message-2",
			),
		});
		const snapshot = await manager.createSession();
		await manager.appendMessage(snapshot.session.id, userMessage("root", 1));
		const fork = await manager.forkBranch(snapshot.session.id, {
			title: "Alternative",
		});
		await manager.appendMessage(snapshot.session.id, userMessage("fork", 2));
		await manager.setActiveBranch(
			snapshot.session.id,
			snapshot.session.rootBranchId,
		);
		await manager.appendMessage(snapshot.session.id, userMessage("root 2", 3));

		const rootRestore = await manager.restore(
			snapshot.session.id,
			snapshot.session.rootBranchId,
		);
		const forkRestore = await manager.restore(snapshot.session.id, fork.id);
		const tree = await manager.getSessionTree(snapshot.session.id);

		expect(rootRestore?.messages).toEqual([
			userMessage("root", 1),
			userMessage("root 2", 3),
		]);
		expect(forkRestore?.messages).toEqual([
			userMessage("root", 1),
			userMessage("fork", 2),
		]);
		expect(tree?.children[0]?.branch).toMatchObject({
			id: "fork",
			title: "Alternative",
			parentBranchId: "root",
			parentEntryId: "root-message",
		});
	});

	it("stores custom entries and supports explicit active branch selection", async () => {
		const manager = createThetaSessionManager({
			createId: fixedIds("session-a", "root", "custom-1", "fork"),
		});
		const snapshot = await manager.createSession();
		const custom = await manager.appendCustomEntry(snapshot.session.id, {
			customType: "checkpoint",
			data: { ok: true },
			display: false,
		});
		const fork = await manager.forkBranch(snapshot.session.id, {
			activate: false,
		});
		const session = await manager.setActiveBranch(snapshot.session.id, fork.id);
		const restored = await manager.restore(snapshot.session.id);

		expect(custom).toMatchObject({
			kind: "custom",
			customType: "checkpoint",
			data: { ok: true },
			display: false,
		});
		expect(session.activeBranchId).toBe(fork.id);
		expect(restored?.branch.id).toBe(fork.id);
	});

	it("persists sessions through browser Storage", async () => {
		const storage = new MemoryStorage();
		const store = createBrowserThetaSessionStore({
			storage,
			key: "test:sessions",
		});
		const manager = createThetaSessionManager({
			store,
			createId: fixedIds("session-a", "root", "entry-1"),
		});
		const snapshot = await manager.createSession({ title: "Persistent" });
		await manager.appendMessage(snapshot.session.id, userMessage("saved", 1));

		const restoredManager = createThetaSessionManager({
			store: createBrowserThetaSessionStore({ storage, key: "test:sessions" }),
		});
		const restored = await restoredManager.restore(snapshot.session.id);

		expect(restored?.session.title).toBe("Persistent");
		expect(restored?.messages).toEqual([userMessage("saved", 1)]);
	});

	it("can use the explicit in-memory store", async () => {
		const store = createMemoryThetaSessionStore();
		const manager = createThetaSessionManager({
			store,
			createId: fixedIds("session-a", "root"),
		});
		await manager.createSession();

		expect(await manager.listSessions()).toHaveLength(1);
	});
});

function fixedIds(...ids: readonly string[]): () => string {
	let index = 0;
	return () => {
		const id = ids[index];
		index += 1;
		if (!id) {
			throw new Error("Ran out of fixed ids.");
		}
		return id;
	};
}

function fixedClock(start: number, step: number): () => number {
	let value = start;
	return () => {
		const current = value;
		value += step;
		return current;
	};
}

class MemoryStorage implements Storage {
	private readonly data = new Map<string, string>();

	get length(): number {
		return this.data.size;
	}

	clear(): void {
		this.data.clear();
	}

	getItem(key: string): string | null {
		return this.data.get(key) ?? null;
	}

	key(index: number): string | null {
		return Array.from(this.data.keys())[index] ?? null;
	}

	removeItem(key: string): void {
		this.data.delete(key);
	}

	setItem(key: string, value: string): void {
		this.data.set(key, value);
	}
}
