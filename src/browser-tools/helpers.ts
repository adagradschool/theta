import {
	basenameWorkspacePath,
	dirnameWorkspacePath,
	normalizeWorkspacePath,
	type DirEntry,
	type FileStat,
	type WorkspaceEntryKind,
	type WorkspaceFs,
	WorkspaceFsError,
	WorkspaceNotFoundError,
	type WriteOptions,
} from "../fs/filesystem.ts";
import type { ThetaTextContent } from "../core/messages.ts";
import type {
	ThetaToolRenderMetadata,
	ThetaToolResult,
} from "../core/tools.ts";

export interface WorkspaceWalkEntry {
	readonly path: string;
	readonly name: string;
	readonly kind: WorkspaceEntryKind;
	readonly stat: FileStat;
}

export function textResult<TDetails>(
	text: string,
	details: TDetails,
	render: ThetaToolRenderMetadata,
): ThetaToolResult<TDetails> {
	return {
		content: [{ type: "text", text } satisfies ThetaTextContent],
		details,
		render,
	};
}

export function assertNotAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new Error("Operation aborted.");
	}
}

export async function ensureParentDirectories(
	fs: WorkspaceFs,
	path: string,
): Promise<void> {
	const parent = dirnameWorkspacePath(path);
	if (parent === "/") {
		return;
	}
	const segments = parent.split("/").filter(Boolean);
	let current = "";
	for (const segment of segments) {
		current = `${current}/${segment}`;
		try {
			await fs.mkdir(current);
		} catch (error) {
			if (!(error instanceof WorkspaceFsError)) {
				throw error;
			}
			if (error.code !== "already_exists") {
				throw error;
			}
		}
	}
}

export async function pathExists(
	fs: WorkspaceFs,
	path: string,
): Promise<boolean> {
	try {
		await fs.stat(path);
		return true;
	} catch (error) {
		if (error instanceof WorkspaceNotFoundError) {
			return false;
		}
		throw error;
	}
}

export async function writeTextWithParents(
	fs: WorkspaceFs,
	path: string,
	content: string,
	options: WriteOptions & { readonly createParents?: boolean } = {},
): Promise<void> {
	const normalized = normalizeWorkspacePath(path);
	const { createParents, ...writeOptions } = options;
	if (createParents ?? true) {
		await ensureParentDirectories(fs, normalized);
	}
	await fs.writeTextFile(normalized, content, writeOptions);
}

export async function walkWorkspace(
	fs: WorkspaceFs,
	rootPath: string,
	options: {
		readonly includeDirectories?: boolean;
		readonly signal?: AbortSignal;
	} = {},
): Promise<WorkspaceWalkEntry[]> {
	const normalized = normalizeWorkspacePath(rootPath);
	options.signal && assertNotAborted(options.signal);
	const stat = await fs.stat(normalized);
	if (stat.kind === "file") {
		return [
			{
				path: normalized,
				name: basenameWorkspacePath(normalized),
				kind: "file",
				stat,
			},
		];
	}

	const entries: WorkspaceWalkEntry[] = [];
	const visit = async (directory: string): Promise<void> => {
		options.signal && assertNotAborted(options.signal);
		const children = await fs.readdir(directory);
		for (const child of children) {
			options.signal && assertNotAborted(options.signal);
			const statForChild = child.stat ?? (await fs.stat(child.path));
			const entry = toWalkEntry(child, statForChild);
			if (entry.kind === "directory") {
				if (options.includeDirectories) {
					entries.push(entry);
				}
				await visit(entry.path);
			} else {
				entries.push(entry);
			}
		}
	};
	await visit(normalized);
	return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function toRelativeWorkspacePath(
	path: string,
	rootPath: string,
): string {
	const normalizedPath = normalizeWorkspacePath(path);
	const normalizedRoot = normalizeWorkspacePath(rootPath);
	if (normalizedPath === normalizedRoot) {
		return basenameWorkspacePath(normalizedPath);
	}
	if (normalizedRoot === "/") {
		return normalizedPath.slice(1);
	}
	return normalizedPath.startsWith(`${normalizedRoot}/`)
		? normalizedPath.slice(normalizedRoot.length + 1)
		: normalizedPath;
}

export function matchesGlob(path: string, pattern: string): boolean {
	return globToRegExp(pattern).test(path);
}

export function matchesPathOrBasename(path: string, pattern: string): boolean {
	if (pattern.includes("/")) {
		return matchesGlob(path, pattern);
	}
	const basename = path.slice(path.lastIndexOf("/") + 1);
	return matchesGlob(basename, pattern) || matchesGlob(path, pattern);
}

export function inferLanguage(path: string): string | undefined {
	const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	if (!extension || extension === path) {
		return undefined;
	}
	const known: Record<string, string> = {
		cjs: "javascript",
		css: "css",
		html: "html",
		js: "javascript",
		json: "json",
		jsx: "javascript",
		md: "markdown",
		mjs: "javascript",
		py: "python",
		rs: "rust",
		sh: "bash",
		sql: "sql",
		ts: "typescript",
		tsx: "typescript",
		txt: "text",
		yaml: "yaml",
		yml: "yaml",
	};
	return known[extension];
}

export function countBytes(text: string): number {
	return new TextEncoder().encode(text).byteLength;
}

export function splitLines(text: string): string[] {
	return text.length === 0 ? [""] : text.split(/\r\n|\r|\n/);
}

export function createUnifiedDiff(
	path: string,
	before: string,
	after: string,
): string {
	if (before === after) {
		return "";
	}
	return [
		`--- ${path}`,
		`+++ ${path}`,
		"@@",
		...prefixLines(before, "-"),
		...prefixLines(after, "+"),
	].join("\n");
}

export function truncateLine(text: string, maxLength: number): string {
	return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function toWalkEntry(entry: DirEntry, stat: FileStat): WorkspaceWalkEntry {
	return {
		path: entry.path,
		name: entry.name,
		kind: entry.kind,
		stat,
	};
}

function prefixLines(text: string, prefix: string): string[] {
	if (text.length === 0) {
		return [`${prefix}`];
	}
	return splitLines(text).map((line) => `${prefix}${line}`);
}

function globToRegExp(pattern: string): RegExp {
	let source = "^";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		const next = pattern[index + 1];
		if (char === "*" && next === "*") {
			const afterNext = pattern[index + 2];
			if (afterNext === "/") {
				source += "(?:.*/)?";
				index += 2;
			} else {
				source += ".*";
				index += 1;
			}
		} else if (char === "*") {
			source += "[^/]*";
		} else if (char === "?") {
			source += "[^/]";
		} else {
			source += escapeRegExp(char ?? "");
		}
	}
	return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
	return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}
