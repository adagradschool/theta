# Runtime Requirements

Theta is published as `@adagradschool/theta`.

## Browser Runtime

The package targets current evergreen browsers:

- Chrome latest
- Edge latest
- Firefox latest
- Safari latest

Theta runtime code is browser-only. It should not depend on Node-only modules, host filesystem APIs, child processes, or local shell execution.

## Server Requirements

Applications embedding Theta must provide a thin server proxy for LLM provider calls. Provider credentials stay server-side and are never exposed to the browser.

Durable sync infrastructure, such as Electric backed by Postgres, is also server-side infrastructure. It remains below the `WorkspaceFs` boundary and should not be visible to agent tools.
