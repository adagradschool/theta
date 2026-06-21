import {
	basenameWorkspacePath,
	dirnameWorkspacePath,
	type FileStat,
	type FsEvent,
	normalizeWorkspacePath,
} from "./filesystem.ts";
import type { JsonValue } from "./json.ts";
import type {
	ThetaAgentEvent,
	ThetaSyncStatus,
	ThetaWorkspaceEvent,
} from "./events.ts";
import type {
	ThetaAssistantMessage,
	ThetaMessage,
	ThetaTextContent,
	ThetaToolCallContent,
} from "./messages.ts";
import type { ThetaToolResult } from "./tools.ts";

export interface ThetaChatItem {
	readonly id: string;
	readonly role: ThetaMessage["role"];
	readonly message: ThetaMessage;
	readonly text: string;
	readonly isStreaming: boolean;
	readonly isError: boolean;
	readonly toolCalls: readonly ThetaToolCallContent[];
}

export interface ThetaChatState {
	readonly items: readonly ThetaChatItem[];
	readonly isStreaming: boolean;
	readonly pendingToolCalls: readonly string[];
	readonly errorMessage?: string;
}

export interface ThetaFileTreeNode {
	readonly path: string;
	readonly name: string;
	readonly kind: "file" | "directory";
	readonly stat?: FileStat;
	readonly children: readonly ThetaFileTreeNode[];
}

export interface ThetaFileTreeState {
	readonly root: ThetaFileTreeNode;
	readonly expandedPaths: ReadonlySet<string>;
	readonly selectedPath?: string;
}

export interface ThetaEditorBinding {
	readonly path: string;
	readonly text: string;
	readonly version?: string;
	readonly dirty: boolean;
	readonly language?: string;
}

export interface ThetaToolRenderItem {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly status: "running" | "complete" | "error";
	readonly title: string;
	readonly summary?: string;
	readonly path?: string;
	readonly language?: string;
	readonly data?: JsonValue;
}

export interface ThetaProgressState {
	readonly isWorking: boolean;
	readonly activeTurns: number;
	readonly activeTools: number;
	readonly activeCompactions: number;
	readonly message?: string;
}

export interface ThetaSyncState {
	readonly status: ThetaSyncStatus;
	readonly message?: string;
	readonly pendingMutations: number;
	readonly failedMutations: number;
}

export function createThetaChatState(
	messages: readonly ThetaMessage[],
	options: {
		readonly streamingMessage?: ThetaMessage;
		readonly pendingToolCalls?: ReadonlySet<string> | readonly string[];
		readonly errorMessage?: string;
	} = {},
): ThetaChatState {
	const pendingToolCalls = Array.from(options.pendingToolCalls ?? []);
	return {
		items: messages
			.concat(options.streamingMessage ? [options.streamingMessage] : [])
			.map((message, index) =>
				toChatItem(message, index, options.streamingMessage),
			),
		isStreaming: options.streamingMessage !== undefined,
		pendingToolCalls,
		...(options.errorMessage !== undefined
			? { errorMessage: options.errorMessage }
			: {}),
	};
}

export function applyThetaFileTreeEvent(
	state: ThetaFileTreeState,
	event: FsEvent,
): ThetaFileTreeState {
	let root = state.root;
	if (event.type === "deleted") {
		root = removeTreeNode(root, event.path);
	} else if (event.type === "renamed" && event.previousPath) {
		root = removeTreeNode(root, event.previousPath);
		root = event.stat ? upsertTreeNode(root, event.path, event.stat) : root;
	} else if (event.stat) {
		root = upsertTreeNode(root, event.path, event.stat);
	}
	const nextState: ThetaFileTreeState = {
		...state,
		root,
	};
	const selectedPath =
		state.selectedPath === event.previousPath ? event.path : state.selectedPath;
	return selectedPath === undefined
		? nextState
		: { ...nextState, selectedPath };
}

export function createThetaFileTreeState(
	options: {
		readonly entries?: readonly FileStat[];
		readonly expandedPaths?: Iterable<string>;
		readonly selectedPath?: string;
	} = {},
): ThetaFileTreeState {
	const expandedPaths = new Set(
		Array.from(options.expandedPaths ?? ["/"]).map(normalizeWorkspacePath),
	);
	let root = createTreeNode("/", "directory");
	for (const entry of options.entries ?? []) {
		root = upsertTreeNode(root, entry.path, entry);
	}
	return {
		root,
		expandedPaths,
		...(options.selectedPath !== undefined
			? { selectedPath: normalizeWorkspacePath(options.selectedPath) }
			: {}),
	};
}

export function createThetaEditorBinding(options: {
	readonly path: string;
	readonly text: string;
	readonly stat?: FileStat;
	readonly savedText?: string;
}): ThetaEditorBinding {
	const language =
		options.stat?.mimeType !== undefined
			? languageFromMimeType(options.stat.mimeType)
			: languageFromPath(options.path);
	return {
		path: normalizeWorkspacePath(options.path),
		text: options.text,
		...(options.stat?.version !== undefined
			? { version: options.stat.version }
			: {}),
		dirty:
			options.savedText !== undefined
				? options.savedText !== options.text
				: false,
		...(language !== undefined ? { language } : {}),
	};
}

export function toolRenderItemFromEvent(
	event: Extract<
		ThetaAgentEvent,
		{ readonly type: "tool_execution_start" | "tool_execution_end" }
	>,
): ThetaToolRenderItem {
	if (event.type === "tool_execution_start") {
		return {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			status: "running",
			title: event.toolName,
		};
	}
	return toolRenderItemFromResult({
		toolCallId: event.toolCallId,
		toolName: event.toolName,
		result: event.result,
	});
}

export function toolRenderItemFromResult(options: {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly result: ThetaToolResult;
}): ThetaToolRenderItem {
	const render = options.result.render;
	return {
		toolCallId: options.toolCallId,
		toolName: options.toolName,
		status: options.result.isError ? "error" : "complete",
		title: render?.title ?? options.toolName,
		...(render?.summary !== undefined ? { summary: render.summary } : {}),
		...(render?.path !== undefined ? { path: render.path } : {}),
		...(render?.language !== undefined ? { language: render.language } : {}),
		...(render?.data !== undefined ? { data: render.data } : {}),
	};
}

export function reduceThetaProgressState(
	state: ThetaProgressState,
	event: ThetaAgentEvent,
): ThetaProgressState {
	switch (event.type) {
		case "turn_start":
			return normalizeProgress({
				...state,
				activeTurns: state.activeTurns + 1,
			});
		case "turn_end":
		case "agent_error":
			return normalizeProgress({
				...state,
				activeTurns: Math.max(0, state.activeTurns - 1),
				...(event.type === "agent_error"
					? { message: event.error.message }
					: {}),
			});
		case "tool_execution_start":
			return normalizeProgress({
				...state,
				activeTools: state.activeTools + 1,
			});
		case "tool_execution_end":
			return normalizeProgress({
				...state,
				activeTools: Math.max(0, state.activeTools - 1),
			});
		case "compaction_start":
			return normalizeProgress({
				...state,
				activeCompactions: state.activeCompactions + 1,
				message: "Compacting session",
			});
		case "compaction_end":
			return normalizeProgress({
				...state,
				activeCompactions: Math.max(0, state.activeCompactions - 1),
			});
		default:
			return state;
	}
}

export function createThetaProgressState(): ThetaProgressState {
	return {
		isWorking: false,
		activeTurns: 0,
		activeTools: 0,
		activeCompactions: 0,
	};
}

export function reduceThetaSyncState(
	state: ThetaSyncState,
	event: ThetaWorkspaceEvent,
): ThetaSyncState {
	if (event.type !== "sync_status") {
		return state;
	}
	return {
		...state,
		status: event.status,
		...(event.message !== undefined ? { message: event.message } : {}),
	};
}

export function createThetaSyncState(
	options: {
		readonly status?: ThetaSyncStatus;
		readonly message?: string;
		readonly pendingMutations?: number;
		readonly failedMutations?: number;
	} = {},
): ThetaSyncState {
	return {
		status: options.status ?? "disabled",
		pendingMutations: options.pendingMutations ?? 0,
		failedMutations: options.failedMutations ?? 0,
		...(options.message !== undefined ? { message: options.message } : {}),
	};
}

function toChatItem(
	message: ThetaMessage,
	index: number,
	streamingMessage: ThetaMessage | undefined,
): ThetaChatItem {
	const toolCalls =
		message.role === "assistant" ? collectToolCalls(message) : [];
	return {
		id: `${message.role}:${message.timestamp}:${index}`,
		role: message.role,
		message,
		text: messageText(message),
		isStreaming: message === streamingMessage,
		isError:
			(message.role === "assistant" && message.stopReason === "error") ||
			(message.role === "toolResult" && message.isError),
		toolCalls,
	};
}

function collectToolCalls(
	message: ThetaAssistantMessage,
): readonly ThetaToolCallContent[] {
	return message.content.filter(
		(content): content is ThetaToolCallContent => content.type === "toolCall",
	);
}

function messageText(message: ThetaMessage): string {
	switch (message.role) {
		case "user":
			return typeof message.content === "string"
				? message.content
				: contentText(message.content);
		case "assistant":
			return contentText(
				message.content.filter(
					(content): content is ThetaTextContent => content.type === "text",
				),
			);
		case "toolResult":
			return contentText(message.content);
		case "bashExecution":
			return message.output;
		case "custom":
			return typeof message.content === "string"
				? message.content
				: contentText(message.content);
		case "compactionSummary":
		case "branchSummary":
			return message.summary;
	}
}

function contentText(content: readonly { readonly type: string }[]): string {
	return content
		.filter((item): item is ThetaTextContent => item.type === "text")
		.map((item) => item.text)
		.join("");
}

function createTreeNode(
	path: string,
	kind: "file" | "directory",
	stat?: FileStat,
): ThetaFileTreeNode {
	return {
		path,
		name: basenameWorkspacePath(path),
		kind,
		...(stat !== undefined ? { stat } : {}),
		children: [],
	};
}

function upsertTreeNode(
	root: ThetaFileTreeNode,
	path: string,
	stat: FileStat,
): ThetaFileTreeNode {
	const normalized = normalizeWorkspacePath(path);
	if (normalized === "/") {
		return { ...root, stat, kind: stat.kind, name: "" };
	}
	const parentPath = dirnameWorkspacePath(normalized);
	const parent =
		findTreeNode(root, parentPath) ?? createTreeNode(parentPath, "directory");
	const child = createTreeNode(normalized, stat.kind, stat);
	const nextParent = {
		...parent,
		children: sortTreeNodes(replaceNode(parent.children, child)),
	};
	return replaceTreeNode(ensureParent(root, parentPath), nextParent);
}

function removeTreeNode(
	root: ThetaFileTreeNode,
	path: string,
): ThetaFileTreeNode {
	const normalized = normalizeWorkspacePath(path);
	if (normalized === "/") {
		return { ...root, children: [] };
	}
	const parentPath = dirnameWorkspacePath(normalized);
	const parent = findTreeNode(root, parentPath);
	if (!parent) {
		return root;
	}
	return replaceTreeNode(root, {
		...parent,
		children: parent.children.filter((child) => child.path !== normalized),
	});
}

function ensureParent(
	root: ThetaFileTreeNode,
	path: string,
): ThetaFileTreeNode {
	const normalized = normalizeWorkspacePath(path);
	if (normalized === "/" || findTreeNode(root, normalized)) {
		return root;
	}
	return upsertTreeNode(root, normalized, {
		path: normalized,
		kind: "directory",
		size: 0,
		mtime: Date.now(),
	});
}

function findTreeNode(
	node: ThetaFileTreeNode,
	path: string,
): ThetaFileTreeNode | undefined {
	if (node.path === path) {
		return node;
	}
	for (const child of node.children) {
		const match = findTreeNode(child, path);
		if (match) {
			return match;
		}
	}
	return undefined;
}

function replaceTreeNode(
	root: ThetaFileTreeNode,
	replacement: ThetaFileTreeNode,
): ThetaFileTreeNode {
	if (root.path === replacement.path) {
		return replacement;
	}
	return {
		...root,
		children: root.children.map((child) => replaceTreeNode(child, replacement)),
	};
}

function replaceNode(
	nodes: readonly ThetaFileTreeNode[],
	node: ThetaFileTreeNode,
): readonly ThetaFileTreeNode[] {
	const existing = nodes.find((candidate) => candidate.path === node.path);
	return existing
		? nodes.map((candidate) =>
				candidate.path === node.path ? node : candidate,
			)
		: [...nodes, node];
}

function sortTreeNodes(
	nodes: readonly ThetaFileTreeNode[],
): readonly ThetaFileTreeNode[] {
	return nodes
		.slice()
		.sort((a, b) =>
			a.kind === b.kind
				? a.path.localeCompare(b.path)
				: a.kind === "directory"
					? -1
					: 1,
		);
}

function languageFromMimeType(mimeType: string): string | undefined {
	if (mimeType.includes("typescript")) {
		return "typescript";
	}
	if (mimeType.includes("javascript")) {
		return "javascript";
	}
	if (mimeType.includes("json")) {
		return "json";
	}
	if (mimeType.startsWith("text/")) {
		return "text";
	}
	return undefined;
}

function languageFromPath(path: string): string | undefined {
	const extension = path.split(".").pop();
	switch (extension) {
		case "ts":
		case "tsx":
			return "typescript";
		case "js":
		case "jsx":
			return "javascript";
		case "json":
			return "json";
		case "md":
			return "markdown";
		case "css":
			return "css";
		case "html":
			return "html";
		default:
			return undefined;
	}
}

function normalizeProgress(state: ThetaProgressState): ThetaProgressState {
	return {
		...state,
		isWorking:
			state.activeTurns > 0 ||
			state.activeTools > 0 ||
			state.activeCompactions > 0,
	};
}
