import { useEffect, useRef } from "react";
import type { useThetaChat } from "../../../src/react.ts";
import type { ThetaChatItem } from "../../../src/ui/ui-state.ts";

export function ConversationView(props: {
	readonly chat: ReturnType<typeof useThetaChat>;
	readonly isWorking: boolean;
}) {
	const visibleItems = props.chat.items.filter(shouldShowChatItem);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const scrollKey = [
		...visibleItems.map((item) =>
			[item.id, item.text, item.isStreaming, item.isError].join(":"),
		),
		props.chat.pendingToolCalls.length,
		props.chat.errorMessage ?? "",
	].join("|");
	useEffect(() => {
		const element = scrollRef.current;
		if (!element) {
			return;
		}
		element.scrollTop = element.scrollHeight;
	});
	void scrollKey;
	return (
		<div className="conversation-view" aria-live="polite" ref={scrollRef}>
			{visibleItems.length === 0 ? (
				<p className="conversation-empty">
					Tell donedone what needs attention. This session will stay here as the
					work unfolds.
				</p>
			) : (
				<ol className="conversation-list">
					{visibleItems.map((item) => (
						<li key={item.id}>
							<ChatMessage item={item} />
						</li>
					))}
				</ol>
			)}
			{props.chat.pendingToolCalls.length > 0 ? (
				<div className="conversation-pending">
					<span className="activity-dot" />
					<div>
						<strong>donedone is using workspace tools</strong>
						<p>{props.chat.pendingToolCalls.length} operation active</p>
					</div>
				</div>
			) : null}
			{props.chat.errorMessage ? (
				<p className="status bad">{props.chat.errorMessage}</p>
			) : null}
		</div>
	);
}

function ChatMessage(props: { readonly item: ThetaChatItem }) {
	return (
		<div
			className={`conversation-item ${props.item.role} ${
				props.item.isStreaming ? "streaming" : ""
			} ${props.item.isError ? "error" : ""}`}
		>
			<div className="conversation-meta">
				<strong>{chatRoleLabel(props.item)}</strong>
				{props.item.isStreaming ? <span>Writing</span> : null}
			</div>
			<div className="conversation-bubble">
				<p>{chatItemText(props.item)}</p>
			</div>
		</div>
	);
}

function shouldShowChatItem(item: ThetaChatItem): boolean {
	if (item.role === "toolResult" || item.role === "bashExecution") {
		return false;
	}
	if (
		item.role === "assistant" &&
		!item.text.trim() &&
		item.toolCalls.length > 0
	) {
		return item.isError;
	}
	return chatItemText(item) !== "No text content." || item.isError;
}

function chatRoleLabel(item: ThetaChatItem): string {
	switch (item.role) {
		case "user":
			return "You";
		case "assistant":
			return "donedone";
		case "toolResult":
			return "Workspace";
		case "bashExecution":
			return "Shell";
		case "compactionSummary":
			return "Summary";
		case "branchSummary":
			return "Branch";
		case "custom":
			return "Note";
	}
}

function chatItemText(item: ThetaChatItem): string {
	const text = item.text.trim();
	if (text) {
		return text;
	}
	if (item.toolCalls.length > 0) {
		return "Requested workspace changes.";
	}
	return "No text content.";
}
