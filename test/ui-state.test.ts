import { describe, expect, it } from "vitest";

import {
	applyThetaFileTreeEvent,
	createThetaChatState,
	createThetaEditorBinding,
	createThetaFileTreeState,
	createThetaProgressState,
	createThetaSyncState,
	reduceThetaProgressState,
	reduceThetaSyncState,
	toolRenderItemFromEvent,
	toolRenderItemFromResult,
	type ThetaMessage,
} from "../src/index.ts";

describe("headless UI state helpers", () => {
	it("derives chat items from messages without UI dependencies", () => {
		const messages: readonly ThetaMessage[] = [
			{ role: "user", content: "hello", timestamp: 1 },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll read it." },
					{
						type: "toolCall",
						id: "tool-1",
						name: "read",
						arguments: { path: "/src/index.ts" },
					},
				],
				provider: "faux",
				model: "faux",
				stopReason: "toolUse",
				timestamp: 2,
			},
		];

		const state = createThetaChatState(messages, {
			pendingToolCalls: new Set(["tool-1"]),
		});

		expect(state.items.map((item) => item.text)).toEqual([
			"hello",
			"I'll read it.",
		]);
		expect(state.items[1]?.toolCalls[0]?.name).toBe("read");
		expect(state.pendingToolCalls).toEqual(["tool-1"]);
	});

	it("updates file tree state from filesystem events", () => {
		let tree = createThetaFileTreeState();
		tree = applyThetaFileTreeEvent(tree, {
			type: "created",
			path: "/src/index.ts",
			stat: {
				path: "/src/index.ts",
				kind: "file",
				size: 10,
				mtime: 1,
				version: "1",
			},
		});

		expect(tree.root.children[0]?.path).toBe("/src");
		expect(tree.root.children[0]?.children[0]?.path).toBe("/src/index.ts");

		tree = applyThetaFileTreeEvent(tree, {
			type: "deleted",
			path: "/src/index.ts",
		});
		expect(tree.root.children[0]?.children).toEqual([]);
	});

	it("creates editor bindings with dirty and language metadata", () => {
		expect(
			createThetaEditorBinding({
				path: "/src/app.ts",
				text: "two",
				savedText: "one",
				stat: {
					path: "/src/app.ts",
					kind: "file",
					size: 3,
					mtime: 1,
					version: "4",
				},
			}),
		).toMatchObject({
			path: "/src/app.ts",
			text: "two",
			version: "4",
			dirty: true,
			language: "typescript",
		});
	});

	it("normalizes tool render state from tool events and results", () => {
		expect(
			toolRenderItemFromEvent({
				type: "tool_execution_start",
				agentId: "agent",
				workspaceId: "workspace",
				toolCallId: "call-1",
				toolName: "write",
				input: { path: "/x.ts" },
			}),
		).toMatchObject({ status: "running", title: "write" });

		expect(
			toolRenderItemFromResult({
				toolCallId: "call-1",
				toolName: "write",
				result: {
					content: [{ type: "text", text: "ok" }],
					render: {
						title: "Wrote /x.ts",
						path: "/x.ts",
						language: "typescript",
						summary: "12 bytes",
					},
				},
			}),
		).toMatchObject({
			status: "complete",
			title: "Wrote /x.ts",
			path: "/x.ts",
			summary: "12 bytes",
		});
	});

	it("reduces progress and sync status events", () => {
		let progress = createThetaProgressState();
		progress = reduceThetaProgressState(progress, {
			type: "turn_start",
			agentId: "agent",
			workspaceId: "workspace",
		});
		expect(progress).toMatchObject({ isWorking: true, activeTurns: 1 });
		progress = reduceThetaProgressState(progress, {
			type: "turn_end",
			agentId: "agent",
			workspaceId: "workspace",
			message: {
				role: "assistant",
				content: [],
				provider: "faux",
				model: "faux",
				stopReason: "stop",
				timestamp: 1,
			},
			toolResults: [],
		});
		expect(progress).toMatchObject({ isWorking: false, activeTurns: 0 });

		const sync = reduceThetaSyncState(createThetaSyncState(), {
			type: "sync_status",
			workspaceId: "workspace",
			status: "connected",
			message: "up to date",
		});
		expect(sync).toMatchObject({ status: "connected", message: "up to date" });
	});
});
