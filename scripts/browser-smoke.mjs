import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({
	configFile: false,
	root: process.cwd(),
	server: {
		host: "127.0.0.1",
		port: 4177,
		strictPort: true,
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
});

await server.listen();
const userDataDir = await mkdtemp(join(tmpdir(), "theta-browser-smoke-"));
const smokeName = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;

try {
	const write = await runPhase("write");
	const read = await runPhase("read");
	for (const value of [write, read]) {
		if (!value?.ok) {
			throw new Error(`Browser smoke failed: ${JSON.stringify(value)}`);
		}
		if (
			value.text !== "export const value = 1;" ||
			value.entryNames?.[0] !== "index.ts" ||
			typeof value.contentHash !== "string" ||
			value.versionCount !== 1 ||
			value.sessionTitle !== "Browser durable smoke" ||
			value.sessionMessages?.[0] !== "persist this"
		) {
			throw new Error(
				`Unexpected browser smoke result: ${JSON.stringify(value)}`,
			);
		}
	}
	console.log("Browser smoke passed");
} finally {
	await rm(userDataDir, { recursive: true, force: true });
	await server.close();
}

async function runPhase(phase) {
	const browser = await chromium.launchPersistentContext(userDataDir, {
		headless: true,
	});
	try {
		const page = await browser.newPage();
		await page.goto(
			`http://127.0.0.1:4177/test/browser/local-storage-smoke.html?name=${encodeURIComponent(smokeName)}&phase=${phase}`,
		);
		const result = await page.waitForFunction(
			() => globalThis.__thetaSmokeResult,
			null,
			{
				timeout: 30_000,
			},
		);
		return await result.jsonValue();
	} finally {
		await browser.close();
	}
}
