# Theta LLM Proxy Worker

Minimal stateless Cloudflare Worker for `createThetaAgent({ proxy })`.

It:

- authenticates the browser request with an app-owned bearer token;
- keeps provider credentials in Worker secrets;
- streams Theta proxy events back as `text/event-stream`;
- stores no state.

## Setup

```sh
npm install
npx wrangler secret put THETA_PROXY_TOKEN
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```

Use the deployed URL from the browser:

```ts
const agent = createThetaAgent({
	workspace,
	model: { provider: "openai", id: "gpt-4.1-nano", api: "openai-responses" },
	proxy: {
		url: "https://theta-proxy.your-subdomain.workers.dev/v1/stream",
		headers: {
			Authorization: `Bearer ${appToken}`,
			"X-Workspace-Id": workspace.id,
		},
	},
});
```

`THETA_PROXY_TOKEN` is only the app-to-proxy auth token. Provider keys such as `OPENAI_API_KEY` stay on the Worker.
