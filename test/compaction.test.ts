import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
	compactThetaSession,
	createMemoryThetaSessionStore,
	createPGliteThetaSessionStore,
	createPGliteWorkspaceMetadataStore,
	createThetaCompactionPrompt,
	createThetaSessionManager,
	estimateThetaContextTokens,
	estimateThetaMessageTokens,
	THETA_LOCAL_STORAGE_SCHEMA_VERSION,
	type ThetaMessage,
	type ThetaSessionManager,
} from "../src/index.ts";

function userMessage(text: string, timestamp: number): ThetaMessage {
	return { role: "user", content: text, timestamp };
}

function assistantMessage(
	text: string,
	timestamp: number,
	input = 100,
	output = 20,
): ThetaMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "faux",
		model: "faux-model",
		usage: {
			input,
			output,
			cacheRead: 10,
			cacheWrite: 5,
			totalTokens: input + output + 15,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

describe("Theta compaction", () => {
	it("estimates message and context tokens with assistant usage", () => {
		const messages = [
			userMessage("hello world", 1),
			assistantMessage("done", 2, 40, 10),
			userMessage("tail text", 3),
		];

		expect(estimateThetaMessageTokens(messages[0] as ThetaMessage)).toBe(3);
		expect(estimateThetaContextTokens(messages)).toMatchObject({
			usageTokens: 65,
			lastUsageIndex: 1,
			tokens: 68,
		});
	});

	it("creates summary prompts with previous summaries and custom instructions", () => {
		const prompt = createThetaCompactionPrompt(
			[
				userMessage("Please edit /src/app.ts", 1),
				{
					role: "toolResult",
					toolCallId: "tool-1",
					toolName: "read",
					content: [{ type: "text", text: "x".repeat(2200) }],
					isError: false,
					timestamp: 2,
				},
			],
			{
				previousSummary: "Older summary",
				customInstructions: "Focus on file paths.",
			},
		);

		expect(prompt).toContain("<previous-summary>");
		expect(prompt).toContain("Older summary");
		expect(prompt).toContain("Additional focus: Focus on file paths.");
		expect(prompt).toContain("[Tool result]:");
		expect(prompt).toContain("more characters truncated");
	});

	it("compacts a session and restores summary plus kept tail", async () => {
		const manager = createTestManager();
		const snapshot = await manager.createSession({
			id: "session-a",
			title: "Compaction",
		});
		await manager.appendMessage(snapshot.session.id, userMessage("one", 1));
		await manager.appendMessage(
			snapshot.session.id,
			assistantMessage("one done", 2),
		);
		await manager.appendMessage(snapshot.session.id, userMessage("two", 3));
		await manager.appendMessage(
			snapshot.session.id,
			assistantMessage("two done", 4),
		);
		await manager.appendMessage(snapshot.session.id, userMessage("three", 5));
		await manager.appendMessage(
			snapshot.session.id,
			assistantMessage("three done", 6),
		);

		const result = await compactThetaSession(manager, snapshot.session.id, {
			settings: { enabled: true, reserveTokens: 10, keepRecentTokens: 2 },
			complete: async ({ messages }) =>
				`summarized ${messages.length} messages`,
		});
		const restored = await manager.restore(snapshot.session.id);

		expect(result?.summary).toBe("summarized 4 messages");
		expect(result?.entry).toMatchObject({
			kind: "compaction",
			firstKeptEntryId: "entry-5",
		});
		expect(restored?.messages.map((message) => message.role)).toEqual([
			"compactionSummary",
			"user",
			"assistant",
		]);
		expect(restored?.messages[0]).toMatchObject({
			role: "compactionSummary",
			summary: "summarized 4 messages",
		});
		expect(restored?.messages.at(-1)).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "three done" }],
		});
	});

	it("persists compaction entries through PGlite sessions", async () => {
		const pg = new PGlite();
		const metadata = createPGliteWorkspaceMetadataStore(pg);
		const manager = createThetaSessionManager({
			store: createPGliteThetaSessionStore({ pg, metadata }),
			createId: fixedIds(
				"root",
				"entry-1",
				"entry-2",
				"entry-3",
				"entry-4",
				"entry-5",
			),
		});
		const snapshot = await manager.createSession({ id: "session-a" });
		await manager.appendMessage(snapshot.session.id, userMessage("old", 1));
		await manager.appendMessage(
			snapshot.session.id,
			assistantMessage("old done", 2),
		);
		await manager.appendMessage(snapshot.session.id, userMessage("new", 3));
		await manager.appendCompactionEntry(snapshot.session.id, {
			summary: "old summary",
			firstKeptEntryId: "entry-3",
			tokensBefore: 200,
			details: { reason: "test" },
		});

		const restoredManager = createThetaSessionManager({
			store: createPGliteThetaSessionStore({ pg, metadata }),
		});
		const restored = await restoredManager.restore(snapshot.session.id);

		expect(await metadata.getSchemaVersion()).toBe(
			THETA_LOCAL_STORAGE_SCHEMA_VERSION,
		);
		expect(restored?.entries.map((entry) => entry.kind)).toEqual([
			"compaction",
			"message",
		]);
		expect(restored?.messages).toEqual([
			{
				role: "compactionSummary",
				summary: "old summary",
				tokensBefore: 200,
				timestamp: expect.any(Number),
			},
			userMessage("new", 3),
		]);

		await pg.close();
	});
});

function createTestManager(): ThetaSessionManager {
	return createThetaSessionManager({
		store: createMemoryThetaSessionStore(),
		createId: fixedIds(
			"root",
			"entry-1",
			"entry-2",
			"entry-3",
			"entry-4",
			"entry-5",
			"entry-6",
			"entry-7",
		),
	});
}

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
