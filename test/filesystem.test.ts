import { describe, expect, it } from "vitest";

import {
	createMemoryWorkspaceFs,
	normalizeWorkspacePath,
	WorkspaceAlreadyExistsError,
	WorkspaceConflictError,
	WorkspaceInvalidPathError,
	WorkspaceIsDirectoryError,
	WorkspaceNotDirectoryError,
	WorkspaceNotFoundError,
	type FsEvent,
} from "../src/index.ts";

describe("workspace path normalization", () => {
	it("normalizes relative and absolute workspace paths", () => {
		expect(normalizeWorkspacePath("")).toBe("/");
		expect(normalizeWorkspacePath(".")).toBe("/");
		expect(normalizeWorkspacePath("/")).toBe("/");
		expect(normalizeWorkspacePath("src/index.ts")).toBe("/src/index.ts");
		expect(normalizeWorkspacePath("/src//./index.ts")).toBe("/src/index.ts");
	});

	it("rejects traversal, backslashes, and NUL bytes", () => {
		expect(() => normalizeWorkspacePath("../x")).toThrow(
			WorkspaceInvalidPathError,
		);
		expect(() => normalizeWorkspacePath("src/../x")).toThrow(
			WorkspaceInvalidPathError,
		);
		expect(() => normalizeWorkspacePath("src\\x")).toThrow(
			WorkspaceInvalidPathError,
		);
		expect(() => normalizeWorkspacePath("src/\0/x")).toThrow(
			WorkspaceInvalidPathError,
		);
	});
});

describe("memory WorkspaceFs", () => {
	it("reads and writes text and binary files without exposing mutable buffers", async () => {
		const fs = createMemoryWorkspaceFs();
		await fs.mkdir("/src");
		await fs.writeTextFile("/src/readme.txt", "hello");

		expect(await fs.readTextFile("src/readme.txt")).toBe("hello");

		const data = new Uint8Array([1, 2, 3]);
		await fs.writeFile("/src/data.bin", data);
		data[0] = 9;

		const firstRead = await fs.readFile("/src/data.bin");
		expect(Array.from(firstRead)).toEqual([1, 2, 3]);
		firstRead[1] = 9;
		expect(Array.from(await fs.readFile("/src/data.bin"))).toEqual([1, 2, 3]);
	});

	it("tracks stats, versions, hashes, and sorted directory entries", async () => {
		const fs = createMemoryWorkspaceFs({
			files: {
				"/b.txt": "b",
				"/a.txt": "a",
			},
			now: () => 1000,
		});

		const entries = await fs.readdir("/");
		expect(entries.map((entry) => entry.path)).toEqual(["/a.txt", "/b.txt"]);

		const before = await fs.stat("/a.txt");
		expect(before.version).toBeDefined();
		const expectedVersion = before.version;
		if (expectedVersion === undefined) {
			throw new Error("Expected file version to be defined.");
		}
		await fs.writeTextFile("/a.txt", "aa", { expectedVersion });
		const after = await fs.stat("/a.txt");

		expect(before.kind).toBe("file");
		expect(before.size).toBe(1);
		expect(after.size).toBe(2);
		expect(after.version).not.toBe(before.version);
		expect(after.contentHash).not.toBe(before.contentHash);
	});

	it("enforces create, overwrite, expected-version, and directory conflicts", async () => {
		const fs = createMemoryWorkspaceFs();

		await expect(fs.writeTextFile("/missing/file.txt", "x")).rejects.toThrow(
			WorkspaceNotFoundError,
		);
		await expect(
			fs.writeTextFile("/new.txt", "x", { create: false }),
		).rejects.toThrow(WorkspaceNotFoundError);

		await fs.writeTextFile("/new.txt", "x");
		await expect(
			fs.writeTextFile("/new.txt", "y", { overwrite: false }),
		).rejects.toThrow(WorkspaceAlreadyExistsError);
		await expect(
			fs.writeTextFile("/new.txt", "y", { expectedVersion: "stale" }),
		).rejects.toThrow(WorkspaceConflictError);
		await expect(fs.readFile("/")).rejects.toThrow(WorkspaceIsDirectoryError);
		await expect(fs.readdir("/new.txt")).rejects.toThrow(
			WorkspaceNotDirectoryError,
		);
	});

	it("renames files and directories without replacing existing paths", async () => {
		const fs = createMemoryWorkspaceFs();
		await fs.mkdir("/src");
		await fs.mkdir("/docs");
		await fs.writeTextFile("/src/index.ts", "export {};");
		await fs.writeTextFile("/docs/readme.md", "# Docs");

		await fs.rename("/src/index.ts", "/src/main.ts");
		expect(await fs.readTextFile("/src/main.ts")).toBe("export {};");
		await expect(fs.stat("/src/index.ts")).rejects.toThrow(
			WorkspaceNotFoundError,
		);

		await expect(fs.rename("/src/main.ts", "/docs/readme.md")).rejects.toThrow(
			WorkspaceAlreadyExistsError,
		);

		await fs.rename("/src", "/lib");
		expect(await fs.readTextFile("/lib/main.ts")).toBe("export {};");
		await expect(fs.stat("/src")).rejects.toThrow(WorkspaceNotFoundError);
	});

	it("deletes files and refuses to delete non-empty directories", async () => {
		const fs = createMemoryWorkspaceFs();
		await fs.mkdir("/src");
		await fs.writeTextFile("/src/index.ts", "export {};");

		await expect(fs.delete("/src")).rejects.toThrow(WorkspaceConflictError);
		await fs.delete("/src/index.ts");
		await fs.delete("/src");

		expect(await fs.readdir("/")).toEqual([]);
	});

	it("emits watch events for exact paths, descendants, and renames", async () => {
		const fs = createMemoryWorkspaceFs();
		const rootEvents: FsEvent[] = [];
		const sourceEvents: FsEvent[] = [];
		const unwatchRoot = fs.watch("/", (event) => rootEvents.push(event));
		const unwatchSource = fs.watch("/src", (event) => sourceEvents.push(event));

		await fs.mkdir("/src");
		await fs.writeTextFile("/src/index.ts", "one");
		await fs.writeTextFile("/src/index.ts", "two");
		await fs.rename("/src/index.ts", "/src/main.ts");
		await fs.delete("/src/main.ts");
		unwatchRoot();
		unwatchSource();
		await fs.writeTextFile("/ignored.txt", "ignored");

		expect(rootEvents.map((event) => event.type)).toEqual([
			"created",
			"created",
			"updated",
			"renamed",
			"deleted",
		]);
		expect(sourceEvents.map((event) => event.path)).toEqual([
			"/src",
			"/src/index.ts",
			"/src/index.ts",
			"/src/main.ts",
			"/src/main.ts",
		]);
		expect(rootEvents.at(-1)?.path).toBe("/src/main.ts");
	});
});
