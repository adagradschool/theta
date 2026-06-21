# Theta Local Proxy

Minimal stateless local Node proxy for `createThetaAgent({ proxy })`.

It:

- serves `POST /v1/stream`;
- authenticates with `Authorization: Bearer <THETA_PROXY_TOKEN>`;
- reads provider credentials from environment variables;
- streams model output back as `text/event-stream`;
- stores no state.

## Run

From the repository root:

```sh
npm run build
set -a
source .env
set +a
THETA_PROXY_TOKEN=local-dev-token node examples/local-proxy/server.mjs
```

Then point Theta at:

```ts
proxy: {
	url: "http://127.0.0.1:8787/v1/stream",
	headers: {
		Authorization: "Bearer local-dev-token",
	},
}
```
