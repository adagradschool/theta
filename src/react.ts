import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	type Dispatch,
	type SetStateAction,
} from "react";

import type { ThetaAgent, ThetaAgentState } from "./agent.ts";
import type { ThetaAgentEvent } from "./events.ts";
import type { FileStat } from "./filesystem.ts";
import type { ThetaToolResult } from "./tools.ts";
import {
	applyThetaFileTreeEvent,
	createThetaChatState,
	createThetaEditorBinding,
	createThetaFileTreeState,
	createThetaProgressState,
	createThetaSyncState,
	reduceThetaProgressState,
	reduceThetaSyncState,
	toolRenderItemFromResult,
	type ThetaChatState,
	type ThetaEditorBinding,
	type ThetaFileTreeState,
	type ThetaProgressState,
	type ThetaSyncState,
	type ThetaToolRenderItem,
} from "./ui-state.ts";
import type { ThetaWorkspace } from "./workspace.ts";

export interface UseThetaFileTreeOptions {
	readonly entries?: readonly FileStat[];
	readonly expandedPaths?: Iterable<string>;
	readonly selectedPath?: string;
	readonly loadInitialEntries?: boolean;
}

export interface UseThetaEditorFileState {
	readonly binding: ThetaEditorBinding | undefined;
	readonly text: string;
	readonly setText: Dispatch<SetStateAction<string>>;
	readonly isLoading: boolean;
	readonly isSaving: boolean;
	readonly error: Error | undefined;
	readonly reload: () => Promise<void>;
	readonly save: (text?: string) => Promise<void>;
}

export function useThetaAgentState(agent: ThetaAgent): ThetaAgentState {
	useThetaSubscriptionVersion(agent);
	return snapshotAgentState(agent);
}

export function useThetaChat(agent: ThetaAgent): ThetaChatState {
	const state = useThetaAgentState(agent);
	return useMemo(
		() =>
			createThetaChatState(state.messages, {
				...(state.streamingMessage !== undefined
					? { streamingMessage: state.streamingMessage }
					: {}),
				pendingToolCalls: state.pendingToolCalls,
				...(state.errorMessage !== undefined
					? { errorMessage: state.errorMessage }
					: {}),
			}),
		[state],
	);
}

export function useThetaProgress(agent: ThetaAgent): ThetaProgressState {
	const [state, setState] = useState(() => createThetaProgressState());
	useEffect(
		() =>
			agent.subscribe((event) => {
				setState((current) => reduceThetaProgressState(current, event));
			}),
		[agent],
	);
	return state;
}

export function useThetaToolTimeline(
	agent: ThetaAgent,
): readonly ThetaToolRenderItem[] {
	const [items, setItems] = useState<readonly ThetaToolRenderItem[]>([]);
	useEffect(
		() =>
			agent.subscribe((event) => {
				const item = toolRenderItemFromAgentEvent(event);
				if (!item) {
					return;
				}
				setItems((current) => upsertToolRenderItem(current, item));
			}),
		[agent],
	);
	return items;
}

export function useThetaFileTree(
	workspace: ThetaWorkspace,
	options: UseThetaFileTreeOptions = {},
): ThetaFileTreeState {
	const {
		entries,
		expandedPaths,
		selectedPath,
		loadInitialEntries = false,
	} = options;
	const [state, setState] = useState(() =>
		createThetaFileTreeState(
			toFileTreeOptions(entries, expandedPaths, selectedPath),
		),
	);

	useEffect(() => {
		setState(
			createThetaFileTreeState(
				toFileTreeOptions(entries, expandedPaths, selectedPath),
			),
		);
	}, [entries, expandedPaths, selectedPath]);

	useEffect(
		() =>
			workspace.subscribe((event) => {
				if (event.type !== "fs_event") {
					return;
				}
				setState((current) => applyThetaFileTreeEvent(current, event.event));
			}),
		[workspace],
	);

	useEffect(() => {
		if (!loadInitialEntries) {
			return;
		}
		let cancelled = false;
		void collectWorkspaceStats(workspace).then((entries) => {
			if (cancelled) {
				return;
			}
			setState((current) =>
				createThetaFileTreeState({
					entries,
					expandedPaths: current.expandedPaths,
					...(current.selectedPath !== undefined
						? { selectedPath: current.selectedPath }
						: {}),
				}),
			);
		});
		return () => {
			cancelled = true;
		};
	}, [workspace, loadInitialEntries]);

	return state;
}

export function useThetaWorkspaceSync(
	workspace: ThetaWorkspace,
): ThetaSyncState {
	const [state, setState] = useState(() => createThetaSyncState());
	useEffect(
		() =>
			workspace.subscribe((event) => {
				setState((current) => reduceThetaSyncState(current, event));
			}),
		[workspace],
	);
	return state;
}

export function useThetaEditorFile(
	workspace: ThetaWorkspace,
	path: string | undefined,
): UseThetaEditorFileState {
	const [text, setText] = useState("");
	const [savedText, setSavedText] = useState("");
	const [stat, setStat] = useState<FileStat | undefined>();
	const [isLoading, setLoading] = useState(false);
	const [isSaving, setSaving] = useState(false);
	const [error, setError] = useState<Error | undefined>();

	const reload = useCallback(async () => {
		if (!path) {
			setText("");
			setSavedText("");
			setStat(undefined);
			return;
		}
		setLoading(true);
		setError(undefined);
		try {
			const [nextText, nextStat] = await Promise.all([
				workspace.fs.readTextFile(path),
				workspace.fs.stat(path),
			]);
			setText(nextText);
			setSavedText(nextText);
			setStat(nextStat);
		} catch (caught) {
			setError(toError(caught));
		} finally {
			setLoading(false);
		}
	}, [workspace, path]);

	const save = useCallback(
		async (nextText = text) => {
			if (!path) {
				return;
			}
			setSaving(true);
			setError(undefined);
			try {
				await workspace.fs.writeTextFile(path, nextText, {
					...(stat?.version !== undefined
						? { expectedVersion: stat.version }
						: {}),
				});
				const nextStat = await workspace.fs.stat(path);
				setText(nextText);
				setSavedText(nextText);
				setStat(nextStat);
			} catch (caught) {
				setError(toError(caught));
				throw caught;
			} finally {
				setSaving(false);
			}
		},
		[workspace, path, stat?.version, text],
	);

	useEffect(() => {
		void reload();
	}, [reload]);

	useEffect(
		() =>
			workspace.subscribe((event) => {
				if (
					event.type !== "fs_event" ||
					path === undefined ||
					event.event.path !== path
				) {
					return;
				}
				if (event.event.type === "deleted") {
					setStat(undefined);
					return;
				}
				if (event.event.stat) {
					setStat(event.event.stat);
				}
			}),
		[workspace, path],
	);

	const binding =
		path === undefined
			? undefined
			: createThetaEditorBinding({
					path,
					text,
					savedText,
					...(stat !== undefined ? { stat } : {}),
				});

	return {
		binding,
		text,
		setText,
		isLoading,
		isSaving,
		error,
		reload,
		save,
	};
}

function useThetaSubscriptionVersion(agent: ThetaAgent): number {
	const [version, setVersion] = useState(0);
	useEffect(
		() =>
			agent.subscribe(() => {
				setVersion((current) => current + 1);
			}),
		[agent],
	);
	return version;
}

function snapshotAgentState(agent: ThetaAgent): ThetaAgentState {
	const state = agent.state;
	return {
		...state,
		tools: state.tools.slice(),
		messages: state.messages.slice(),
		pendingToolCalls: new Set(state.pendingToolCalls),
	};
}

function toFileTreeOptions(
	entries: readonly FileStat[] | undefined,
	expandedPaths: Iterable<string> | undefined,
	selectedPath: string | undefined,
): Parameters<typeof createThetaFileTreeState>[0] {
	return {
		...(entries !== undefined ? { entries } : {}),
		...(expandedPaths !== undefined ? { expandedPaths } : {}),
		...(selectedPath !== undefined ? { selectedPath } : {}),
	};
}

function toolRenderItemFromAgentEvent(
	event: ThetaAgentEvent,
): ThetaToolRenderItem | undefined {
	switch (event.type) {
		case "tool_execution_start":
			return {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				status: "running",
				title: event.toolName,
			};
		case "tool_execution_update":
			return toolRenderItemFromPartialResult(
				event.toolCallId,
				event.toolName,
				event.partialResult,
			);
		case "tool_execution_end":
			return toolRenderItemFromResult({
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: event.result,
			});
		default:
			return undefined;
	}
}

function toolRenderItemFromPartialResult(
	toolCallId: string,
	toolName: string,
	result: ThetaToolResult,
): ThetaToolRenderItem {
	return {
		...toolRenderItemFromResult({ toolCallId, toolName, result }),
		status: result.isError ? "error" : "running",
	};
}

function upsertToolRenderItem(
	items: readonly ThetaToolRenderItem[],
	item: ThetaToolRenderItem,
): readonly ThetaToolRenderItem[] {
	const index = items.findIndex(
		(candidate) => candidate.toolCallId === item.toolCallId,
	);
	if (index === -1) {
		return [...items, item];
	}
	return items.map((candidate, candidateIndex) =>
		candidateIndex === index ? item : candidate,
	);
}

async function collectWorkspaceStats(
	workspace: ThetaWorkspace,
	path = "/",
): Promise<readonly FileStat[]> {
	const entries = await workspace.fs.readdir(path);
	const stats: FileStat[] = [];
	for (const entry of entries) {
		const stat = entry.stat ?? (await workspace.fs.stat(entry.path));
		stats.push(stat);
		if (entry.kind === "directory") {
			stats.push(...(await collectWorkspaceStats(workspace, entry.path)));
		}
	}
	return stats;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
