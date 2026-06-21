import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
	createMemoryThetaSessionStore,
	createPGliteThetaSessionStore,
	createPGliteWorkspaceMetadataStore,
	THETA_LOCAL_STORAGE_SCHEMA_VERSION,
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

	it("persists sessions through PGlite durable metadata tables", async () => {
		const pg = new PGlite();
		const metadata = createPGliteWorkspaceMetadataStore(pg);
		const store = createPGliteThetaSessionStore({ pg, metadata });
		const manager = createThetaSessionManager({
			store,
			now: fixedClock(1000, 10),
			createId: fixedIds(
				"session-a",
				"root",
				"model",
				"thinking",
				"root-message",
				"fork",
				"branch-message",
				"custom",
			),
		});

		const snapshot = await manager.createSession({
			title: "Durable",
			workspaceId: "workspace-a",
			metadata: { source: "test" },
		});
		await manager.appendModelChange(snapshot.session.id, {
			provider: "openai",
			id: "gpt-4.1-nano",
		});
		await manager.appendThinkingLevelChange(snapshot.session.id, "high");
		await manager.appendMessage(snapshot.session.id, userMessage("root", 1));
		const fork = await manager.forkBranch(snapshot.session.id, {
			title: "Durable branch",
		});
		await manager.appendMessage(snapshot.session.id, userMessage("branch", 2));
		await manager.appendCustomEntry(snapshot.session.id, {
			customType: "checkpoint",
			data: { persisted: true },
		});

		const restoredManager = createThetaSessionManager({
			store: createPGliteThetaSessionStore({ pg, metadata }),
		});
		const restored = await restoredManager.restore(snapshot.session.id);
		const tree = await restoredManager.getSessionTree(snapshot.session.id);

		expect(await metadata.getSchemaVersion()).toBe(
			THETA_LOCAL_STORAGE_SCHEMA_VERSION,
		);
		expect(restored?.session).toMatchObject({
			id: "session-a",
			workspaceId: "workspace-a",
			title: "Durable",
			metadata: { source: "test" },
		});
		expect(restored?.branch.id).toBe(fork.id);
		expect(restored?.model).toMatchObject({ id: "gpt-4.1-nano" });
		expect(restored?.thinkingLevel).toBe("high");
		expect(restored?.messages).toEqual([
			userMessage("root", 1),
			userMessage("branch", 2),
		]);
		expect(restored?.entries.at(-1)).toMatchObject({
			kind: "custom",
			customType: "checkpoint",
			data: { persisted: true },
		});
		expect(tree?.children[0]?.branch.title).toBe("Durable branch");

		await pg.close();
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
