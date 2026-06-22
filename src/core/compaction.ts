import type { Message } from "@earendil-works/pi-ai/base";
import {
	convertThetaMessagesToLlm,
	type ThetaMessage,
	type ThetaUsage,
} from "./messages.ts";
import type {
	ThetaSessionCompactionEntry,
	ThetaSessionEntry,
	ThetaSessionManager,
	ThetaSessionRestore,
} from "../sessions/index.ts";

export interface ThetaCompactionSettings {
	readonly enabled: boolean;
	readonly reserveTokens: number;
	readonly keepRecentTokens: number;
}

export const DEFAULT_THETA_COMPACTION_SETTINGS: ThetaCompactionSettings = {
	enabled: true,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
};

export interface ThetaContextUsageEstimate {
	readonly tokens: number;
	readonly usageTokens: number;
	readonly trailingTokens: number;
	readonly lastUsageIndex: number | null;
}

export interface ThetaCompactionCutPoint {
	readonly firstKeptEntryIndex: number;
	readonly firstKeptEntryId: string;
}

export interface ThetaCompactionPreparation {
	readonly entries: readonly ThetaSessionEntry[];
	readonly messagesToSummarize: readonly ThetaMessage[];
	readonly firstKeptEntryId: string;
	readonly tokensBefore: number;
	readonly previousSummary?: string;
}

export interface ThetaCompactionPromptOptions {
	readonly previousSummary?: string;
	readonly customInstructions?: string;
}

export interface ThetaCompactionSummaryRequest
	extends ThetaCompactionPromptOptions {
	readonly messages: readonly ThetaMessage[];
	readonly signal?: AbortSignal;
}

export type ThetaCompactionSummaryFunction = (
	request: ThetaCompactionSummaryRequest,
) => Promise<string>;

export interface CompactThetaSessionOptions {
	readonly branchId?: string;
	readonly settings?: ThetaCompactionSettings;
	readonly customInstructions?: string;
	readonly complete: ThetaCompactionSummaryFunction;
	readonly signal?: AbortSignal;
}

export interface CompactThetaSessionResult {
	readonly entry: ThetaSessionCompactionEntry;
	readonly preparation: ThetaCompactionPreparation;
	readonly summary: string;
}

const ESTIMATED_IMAGE_CHARS = 4_800;
const TOOL_RESULT_MAX_CHARS = 2_000;

export function calculateThetaContextTokens(usage: ThetaUsage): number {
	return (
		usage.totalTokens ??
		usage.input + usage.output + usage.cacheRead + usage.cacheWrite
	);
}

export function estimateThetaContextTokens(
	messages: readonly ThetaMessage[],
): ThetaContextUsageEstimate {
	const usageInfo = getLastAssistantUsageInfo(messages);
	if (!usageInfo) {
		const tokens = messages.reduce(
			(total, message) => total + estimateThetaMessageTokens(message),
			0,
		);
		return {
			tokens,
			usageTokens: 0,
			trailingTokens: tokens,
			lastUsageIndex: null,
		};
	}

	const usageTokens = calculateThetaContextTokens(usageInfo.usage);
	let trailingTokens = 0;
	for (let index = usageInfo.index + 1; index < messages.length; index += 1) {
		const message = messages[index];
		if (message) {
			trailingTokens += estimateThetaMessageTokens(message);
		}
	}
	return {
		tokens: usageTokens + trailingTokens,
		usageTokens,
		trailingTokens,
		lastUsageIndex: usageInfo.index,
	};
}

export function shouldCompactThetaContext(
	contextTokens: number,
	contextWindow: number,
	settings: ThetaCompactionSettings = DEFAULT_THETA_COMPACTION_SETTINGS,
): boolean {
	return (
		settings.enabled && contextTokens > contextWindow - settings.reserveTokens
	);
}

export function estimateThetaMessageTokens(message: ThetaMessage): number {
	let chars = 0;
	if (message.role === "user") {
		chars = estimateTextAndImageContentChars(message.content);
	} else if (message.role === "assistant") {
		for (const block of message.content) {
			if (block.type === "text") {
				chars += block.text.length;
			} else if (block.type === "thinking") {
				chars += block.thinking.length;
			} else if (block.type === "toolCall") {
				chars += block.name.length + safeJsonStringify(block.arguments).length;
			}
		}
	} else if (message.role === "toolResult") {
		chars = estimateTextAndImageContentChars(message.content);
	} else if (message.role === "bashExecution") {
		chars = message.command.length + message.output.length;
	} else if (message.role === "custom") {
		chars = estimateTextAndImageContentChars(message.content);
	} else if (
		message.role === "branchSummary" ||
		message.role === "compactionSummary"
	) {
		chars = message.summary.length;
	}
	return Math.ceil(chars / 4);
}

export function prepareThetaCompaction(
	restore: ThetaSessionRestore,
	settings: ThetaCompactionSettings = DEFAULT_THETA_COMPACTION_SETTINGS,
): ThetaCompactionPreparation | undefined {
	if (!settings.enabled) {
		return undefined;
	}
	const entries = restore.entries;
	const messages = restore.messages;
	if (entries.length === 0 || messages.length === 0) {
		return undefined;
	}
	const cutPoint = findThetaCompactionCutPoint(
		entries,
		settings.keepRecentTokens,
	);
	if (!cutPoint || cutPoint.firstKeptEntryIndex <= 0) {
		return undefined;
	}
	const previousSummary = latestCompactionSummary(entries);
	const messagesToSummarize = entries
		.slice(0, cutPoint.firstKeptEntryIndex)
		.flatMap(entryToMessagesForCompaction);
	if (messagesToSummarize.length === 0) {
		return undefined;
	}
	return {
		entries,
		messagesToSummarize,
		firstKeptEntryId: cutPoint.firstKeptEntryId,
		tokensBefore: estimateThetaContextTokens(messages).tokens,
		...(previousSummary !== undefined ? { previousSummary } : {}),
	};
}

export function findThetaCompactionCutPoint(
	entries: readonly ThetaSessionEntry[],
	keepRecentTokens: number,
): ThetaCompactionCutPoint | undefined {
	const validCutPoints = findValidCutPoints(entries);
	if (validCutPoints.length === 0) {
		return undefined;
	}
	let accumulatedTokens = 0;
	let cutIndex = validCutPoints[0] ?? 0;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry || entry.kind !== "message") {
			continue;
		}
		accumulatedTokens += estimateThetaMessageTokens(entry.message);
		if (accumulatedTokens >= keepRecentTokens) {
			cutIndex =
				validCutPoints
					.slice()
					.reverse()
					.find((candidate) => candidate <= index) ?? cutIndex;
			break;
		}
	}
	const firstKeptEntry = entries[cutIndex];
	return firstKeptEntry
		? {
				firstKeptEntryIndex: cutIndex,
				firstKeptEntryId: firstKeptEntry.id,
			}
		: undefined;
}

export async function compactThetaSession(
	manager: ThetaSessionManager,
	sessionId: string,
	options: CompactThetaSessionOptions,
): Promise<CompactThetaSessionResult | undefined> {
	const restore = await manager.restore(sessionId, options.branchId);
	if (!restore) {
		return undefined;
	}
	const preparation = prepareThetaCompaction(
		restore,
		options.settings ?? DEFAULT_THETA_COMPACTION_SETTINGS,
	);
	if (!preparation) {
		return undefined;
	}
	const summary = await generateThetaCompactionSummary({
		messages: preparation.messagesToSummarize,
		complete: options.complete,
		...(preparation.previousSummary !== undefined
			? { previousSummary: preparation.previousSummary }
			: {}),
		...(options.customInstructions !== undefined
			? { customInstructions: options.customInstructions }
			: {}),
		...(options.signal !== undefined ? { signal: options.signal } : {}),
	});
	const entry = await manager.appendCompactionEntry(sessionId, {
		branchId: restore.branch.id,
		summary,
		firstKeptEntryId: preparation.firstKeptEntryId,
		tokensBefore: preparation.tokensBefore,
	});
	return { entry, preparation, summary };
}

export async function generateThetaCompactionSummary(options: {
	readonly messages: readonly ThetaMessage[];
	readonly complete: ThetaCompactionSummaryFunction;
	readonly previousSummary?: string;
	readonly customInstructions?: string;
	readonly signal?: AbortSignal;
}): Promise<string> {
	return options.complete({
		messages: options.messages,
		...(options.previousSummary !== undefined
			? { previousSummary: options.previousSummary }
			: {}),
		...(options.customInstructions !== undefined
			? { customInstructions: options.customInstructions }
			: {}),
		...(options.signal !== undefined ? { signal: options.signal } : {}),
	});
}

export const THETA_COMPACTION_SYSTEM_PROMPT =
	"You are a context summarization assistant. Do not continue the conversation. Only output the requested structured summary.";

export function createThetaCompactionPrompt(
	messages: readonly ThetaMessage[],
	options: ThetaCompactionPromptOptions = {},
): string {
	const conversationText = serializeThetaConversation(
		convertThetaMessagesToLlm(messages),
	);
	let prompt = `<conversation>\n${conversationText}\n</conversation>\n\n`;
	if (options.previousSummary) {
		prompt += `<previous-summary>\n${options.previousSummary}\n</previous-summary>\n\n`;
	}
	prompt += options.previousSummary
		? UPDATE_SUMMARIZATION_PROMPT
		: SUMMARIZATION_PROMPT;
	if (options.customInstructions) {
		prompt += `\n\nAdditional focus: ${options.customInstructions}`;
	}
	return prompt;
}

export function serializeThetaConversation(
	messages: readonly Message[],
): string {
	const parts: string[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			const content =
				typeof message.content === "string"
					? message.content
					: message.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("");
			if (content) {
				parts.push(`[User]: ${content}`);
			}
		} else if (message.role === "assistant") {
			const textParts: string[] = [];
			const thinkingParts: string[] = [];
			const toolCalls: string[] = [];
			for (const block of message.content) {
				if (block.type === "text") {
					textParts.push(block.text);
				} else if (block.type === "thinking") {
					thinkingParts.push(block.thinking);
				} else if (block.type === "toolCall") {
					const args = block.arguments as Record<string, unknown>;
					toolCalls.push(`${block.name}(${formatArgs(args)})`);
				}
			}
			if (thinkingParts.length > 0) {
				parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
			}
			if (textParts.length > 0) {
				parts.push(`[Assistant]: ${textParts.join("\n")}`);
			}
			if (toolCalls.length > 0) {
				parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
			}
		} else if (message.role === "toolResult") {
			const content = message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("");
			if (content) {
				parts.push(
					`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`,
				);
			}
		}
	}
	return parts.join("\n\n");
}

function findValidCutPoints(entries: readonly ThetaSessionEntry[]): number[] {
	const cutPoints: number[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (!entry) {
			continue;
		}
		if (entry.kind === "compaction") {
			cutPoints.push(index);
		} else if (entry.kind === "custom") {
			cutPoints.push(index);
		} else if (entry.kind === "message" && isTurnStartMessage(entry.message)) {
			cutPoints.push(index);
		}
	}
	return cutPoints;
}

function isTurnStartMessage(message: ThetaMessage): boolean {
	return (
		message.role === "user" ||
		message.role === "bashExecution" ||
		message.role === "custom" ||
		message.role === "branchSummary" ||
		message.role === "compactionSummary"
	);
}

function entryToMessagesForCompaction(
	entry: ThetaSessionEntry,
): readonly ThetaMessage[] {
	if (entry.kind === "message") {
		return [entry.message];
	}
	if (entry.kind === "compaction") {
		return [];
	}
	if (entry.kind === "custom" && entry.display) {
		return [
			{
				role: "custom",
				customType: entry.customType,
				content: JSON.stringify(entry.data),
				display: entry.display,
				timestamp: entry.createdAt,
			},
		];
	}
	return [];
}

function latestCompactionSummary(
	entries: readonly ThetaSessionEntry[],
): string | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.kind === "compaction") {
			return entry.summary;
		}
	}
	return undefined;
}

function getLastAssistantUsageInfo(
	messages: readonly ThetaMessage[],
): { readonly usage: ThetaUsage; readonly index: number } | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (
			message?.role === "assistant" &&
			message.usage &&
			message.stopReason !== "aborted" &&
			message.stopReason !== "error"
		) {
			return { usage: message.usage, index };
		}
	}
	return undefined;
}

function estimateTextAndImageContentChars(
	content:
		| string
		| readonly { readonly type: string; readonly text?: string }[],
): number {
	if (typeof content === "string") {
		return content.length;
	}
	let chars = 0;
	for (const block of content) {
		if (block.type === "text" && block.text) {
			chars += block.text.length;
		} else if (block.type === "image") {
			chars += ESTIMATED_IMAGE_CHARS;
		}
	}
	return chars;
}

function truncateForSummary(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, maxChars)}\n\n[... ${text.length - maxChars} more characters truncated]`;
}

function formatArgs(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => `${key}=${safeJsonStringify(value)}`)
		.join(", ");
}

function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "undefined";
	} catch {
		return "[unserializable]";
	}
}

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, file paths, function names, or errors needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. Preserve previous decisions and critical context. Add new progress, decisions, and next steps from the new messages.

Use the same section format:

## Goal
## Constraints & Preferences
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Next Steps
## Critical Context

Keep each section concise. Preserve exact file paths, function names, and error messages.`;
