import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
	createMemoryWorkspaceFs,
	createThetaAgent,
	createThetaWorkspace,
	type ThetaAgentRuntimeAdapter,
	type ThetaMessage,
} from "../src/index.ts";
import {
	useThetaChat,
	useThetaEditorFile,
	useThetaFileTree,
	useThetaProgress,
	useThetaToolTimeline,
} from "../src/react.ts";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];

afterEach(() => {
	for (const root of mountedRoots.splice(0)) {
		act(() => {
			root.unmount();
		});
	}
	document.body.replaceChildren();
});

describe("React hooks", () => {
	it("subscribes to agent state for chat, progress, and tool timeline", async () => {
		const workspace = createThetaWorkspace({
			id: "react-workspace",
			fs: createMemoryWorkspaceFs(),
		});
		const runtime: ThetaAgentRuntimeAdapter = {
			async prompt(messages, context) {
				for (const message of messages) {
					context.appendMessage(message);
				}
				await context.emit({
					type: "turn_start",
					agentId: context.agentId,
					workspaceId: context.workspace.id,
				});
				await context.emit({
					type: "tool_execution_start",
					agentId: context.agentId,
					workspaceId: context.workspace.id,
					toolCallId: "call-1",
					toolName: "read",
					input: { path: "/hello.txt" },
				});
				await context.emit({
					type: "tool_execution_end",
					agentId: context.agentId,
					workspaceId: context.workspace.id,
					toolCallId: "call-1",
					toolName: "read",
					result: {
						content: [{ type: "text", text: "hello" }],
						render: { title: "Read /hello.txt", path: "/hello.txt" },
					},
					isError: false,
				});
				const assistant: ThetaMessage = {
					role: "assistant",
					content: [{ type: "text", text: "done" }],
					provider: "faux",
					model: "faux",
					stopReason: "stop",
					timestamp: 1,
				};
				context.appendMessage(assistant);
				await context.emit({
					type: "message_end",
					agentId: context.agentId,
					workspaceId: context.workspace.id,
					message: assistant,
				});
				await context.emit({
					type: "turn_end",
					agentId: context.agentId,
					workspaceId: context.workspace.id,
					message: assistant,
					toolResults: [],
				});
			},
			async continue() {},
		};
		const agent = createThetaAgent({ workspace, runtime });

		const view = renderHook(() => ({
			chat: useThetaChat(agent),
			progress: useThetaProgress(agent),
			tools: useThetaToolTimeline(agent),
		}));

		await act(async () => {
			await agent.prompt("hello");
		});

		expect(view.current.chat.items.map((item) => item.text)).toEqual([
			"hello",
			"done",
		]);
		expect(view.current.progress.isWorking).toBe(false);
		expect(view.current.tools).toHaveLength(1);
		expect(view.current.tools[0]).toMatchObject({
			status: "complete",
			title: "Read /hello.txt",
			path: "/hello.txt",
		});
	});

	it("subscribes to workspace file tree events", async () => {
		const workspace = createThetaWorkspace({
			id: "react-tree-workspace",
			fs: createMemoryWorkspaceFs(),
		});
		const view = renderHook(() => useThetaFileTree(workspace));

		await act(async () => {
			await workspace.fs.mkdir("/src");
			await workspace.fs.writeTextFile("/src/index.ts", "export {};");
		});

		expect(view.current.root.children[0]?.path).toBe("/src");
		expect(view.current.root.children[0]?.children[0]?.path).toBe(
			"/src/index.ts",
		);
	});

	it("binds an editor file and saves through WorkspaceFs", async () => {
		const workspace = createThetaWorkspace({
			id: "react-editor-workspace",
			fs: createMemoryWorkspaceFs(),
		});
		await workspace.fs.mkdir("/src");
		await workspace.fs.writeTextFile("/src/app.ts", "const value = 1;");
		const view = renderHook(() => useThetaEditorFile(workspace, "/src/app.ts"));

		await act(async () => {
			await view.current.reload();
		});
		expect(view.current.binding).toMatchObject({
			path: "/src/app.ts",
			text: "const value = 1;",
			dirty: false,
			language: "typescript",
		});

		act(() => {
			view.current.setText("const value = 2;");
		});
		expect(view.current.binding).toMatchObject({ dirty: true });

		await act(async () => {
			await view.current.save();
		});

		await expect(workspace.fs.readTextFile("/src/app.ts")).resolves.toBe(
			"const value = 2;",
		);
		expect(view.current.binding).toMatchObject({ dirty: false });
	});
});

function renderHook<T>(hook: () => T): { readonly current: T } {
	let current: T | undefined;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mountedRoots.push(root);

	function TestComponent(): null {
		current = hook();
		return null;
	}

	act(() => {
		root.render(createElement(TestComponent));
	});

	return {
		get current(): T {
			if (current === undefined) {
				throw new Error("Hook did not render.");
			}
			return current;
		},
	};
}
