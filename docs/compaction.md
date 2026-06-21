# Compaction

Theta compaction replaces old session history with a durable summary entry while keeping the recent tail of the conversation intact.

The core API is `compactThetaSession(manager, sessionId, options)`. It:

1. restores the active session branch,
2. estimates context tokens,
3. selects a turn-start cut point,
4. asks the host-provided `complete` function to generate a summary,
5. stores a `compaction` session entry in the session store.

On restore, the session manager returns a synthetic `compactionSummary` message followed by the kept tail. The original entries remain in storage for audit/history; they are just omitted from restored model context after the latest compaction entry.

The host owns LLM routing for summaries:

```ts
await compactThetaSession(sessionManager, sessionId, {
	settings: {
		enabled: true,
		reserveTokens: 16_384,
		keepRecentTokens: 20_000,
	},
	complete: async ({ messages, previousSummary, customInstructions }) => {
		const prompt = createThetaCompactionPrompt(messages, {
			previousSummary,
			customInstructions,
		});
		return callAppLlmProxy(prompt);
	},
});
```

Use `estimateThetaContextTokens()` and `shouldCompactThetaContext()` to decide when a runtime should trigger automatic compaction.

`createThetaAgent()` can also persist and compact a session automatically when given both `session` and `compaction` options:

```ts
const agent = createThetaAgent({
	workspace,
	model,
	session: {
		manager: sessionManager,
		sessionId,
	},
	compaction: {
		contextWindow: 128_000,
		settings: {
			enabled: true,
			reserveTokens: 16_384,
			keepRecentTokens: 20_000,
		},
		complete: async ({ messages, previousSummary }) => {
			const prompt = createThetaCompactionPrompt(messages, { previousSummary });
			return callAppLlmProxy(prompt);
		},
	},
});
```

After each run, the agent appends new messages to the configured session, estimates restored context size, stores a durable compaction entry when the threshold is exceeded, then replaces in-memory context with the restored compaction summary plus recent tail.
