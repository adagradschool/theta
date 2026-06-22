# donedone Client Example

Client-side BYOK donedone workspace inspired by `adagradschool/cc-gtd`.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4180`.

## What It Wires

- Browser agent runtime with direct client-side OpenAI BYOK.
- PGlite metadata in an OPFS-backed worker.
- Content-addressed file blobs in OPFS.
- Browser file tools and browser-local bash against the same `WorkspaceFs`.
- File tree, editor, chat panel, tool timeline, shell panel, and persistence smoke control.

The OpenAI key is stored in browser `localStorage` for this BYOK example. No proxy or server credential storage is used.

## Verify

```bash
npm run build
npm run smoke
```
