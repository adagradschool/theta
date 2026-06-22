import {
	normalizeWorkspacePath,
	type WorkspaceFs,
	WorkspaceFsError,
} from "../fs/filesystem.ts";
import {
	basenameShellPath,
	isDescendantShellPath,
	joinShellPath,
	normalizeShellPath,
} from "./path.ts";
import type { WorkspaceShellAdapter, WorkspaceShellEntry } from "./types.ts";

export function createWorkspaceShellAdapter(
	fs: WorkspaceFs,
): WorkspaceShellAdapter {
	return new WorkspaceFsShellAdapter(fs);
}

class WorkspaceFsShellAdapter implements WorkspaceShellAdapter {
	constructor(private readonly fs: WorkspaceFs) {}

	async exists(path: string): Promise<boolean> {
		try {
			await this.fs.stat(normalizeShellPath(path));
			return true;
		} catch (error) {
			if (isNotFound(error)) {
				return false;
			}
			throw error;
		}
	}

	async stat(path: string): Promise<WorkspaceShellEntry> {
		const normalized = normalizeShellPath(path);
		const stat = await this.fs.stat(normalized);
		return {
			path: normalized,
			name: basenameShellPath(normalized),
			kind: stat.kind,
			size: stat.size,
		};
	}

	async readText(path: string): Promise<string> {
		return this.fs.readTextFile(normalizeShellPath(path));
	}

	async writeText(path: string, text: string): Promise<void> {
		await this.fs.writeTextFile(normalizeShellPath(path), text);
	}

	async appendText(path: string, text: string): Promise<void> {
		const normalized = normalizeShellPath(path);
		const previous = (await this.exists(normalized))
			? await this.readText(normalized)
			: "";
		await this.writeText(normalized, `${previous}${text}`);
	}

	async mkdir(
		path: string,
		options: { readonly recursive?: boolean } = {},
	): Promise<void> {
		const normalized = normalizeShellPath(path);
		if (options.recursive) {
			await this.mkdirp(normalized);
			return;
		}
		await this.fs.mkdir(normalized);
	}

	async list(path: string): Promise<readonly WorkspaceShellEntry[]> {
		const entries = await this.fs.readdir(normalizeShellPath(path));
		return entries.map((entry) => ({
			path: entry.path,
			name: entry.name,
			kind: entry.kind,
			size: entry.stat?.size ?? 0,
		}));
	}

	async walk(path: string): Promise<readonly WorkspaceShellEntry[]> {
		const normalized = normalizeShellPath(path);
		const root = await this.stat(normalized);
		if (root.kind === "file") {
			return [root];
		}
		const entries: WorkspaceShellEntry[] = [];
		const visit = async (directory: string): Promise<void> => {
			for (const entry of await this.list(directory)) {
				entries.push(entry);
				if (entry.kind === "directory") {
					await visit(entry.path);
				}
			}
		};
		await visit(normalized);
		return entries.sort((left, right) => left.path.localeCompare(right.path));
	}

	async delete(
		path: string,
		options: { readonly recursive?: boolean; readonly force?: boolean } = {},
	): Promise<void> {
		const normalized = normalizeShellPath(path);
		if (normalized === "/") {
			throw new Error("rm: refusing to remove workspace root");
		}
		if (!(await this.exists(normalized))) {
			if (options.force) {
				return;
			}
			await this.fs.delete(normalized);
			return;
		}
		const entry = await this.stat(normalized);
		if (entry.kind === "directory" && options.recursive) {
			const descendants = (await this.walk(normalized))
				.filter((descendant) => descendant.path !== normalized)
				.sort((left, right) => right.path.localeCompare(left.path));
			for (const descendant of descendants) {
				await this.fs.delete(descendant.path);
			}
		}
		await this.fs.delete(normalized);
	}

	async copy(
		from: string,
		to: string,
		options: { readonly recursive?: boolean } = {},
	): Promise<void> {
		const source = normalizeShellPath(from);
		let target = normalizeShellPath(to);
		if (
			(await this.exists(target)) &&
			(await this.stat(target)).kind === "directory"
		) {
			target = joinShellPath(target, basenameShellPath(source));
		}
		const sourceEntry = await this.stat(source);
		if (sourceEntry.kind === "file") {
			await this.fs.writeFile(target, await this.fs.readFile(source));
			return;
		}
		if (!options.recursive) {
			throw new Error(`cp: -r not specified; omitting directory '${from}'`);
		}
		await this.mkdir(target, { recursive: true });
		for (const descendant of await this.walk(source)) {
			const relative = descendant.path.slice(source.length + 1);
			const destinationPath = joinShellPath(target, relative);
			if (descendant.kind === "directory") {
				await this.mkdir(destinationPath, { recursive: true });
			} else {
				await this.fs.writeFile(
					destinationPath,
					await this.fs.readFile(descendant.path),
				);
			}
		}
	}

	async move(from: string, to: string): Promise<void> {
		const source = normalizeShellPath(from);
		let target = normalizeShellPath(to);
		if (isDescendantShellPath(source, target)) {
			throw new Error(`mv: cannot move '${from}' into itself`);
		}
		if (
			(await this.exists(target)) &&
			(await this.stat(target)).kind === "directory"
		) {
			target = joinShellPath(target, basenameShellPath(source));
		}
		if (await this.exists(target)) {
			await this.delete(target, { recursive: true, force: true });
		}
		await this.fs.rename(source, target);
	}

	async touch(path: string): Promise<void> {
		const normalized = normalizeShellPath(path);
		if (await this.exists(normalized)) {
			const entry = await this.stat(normalized);
			if (entry.kind === "directory") {
				return;
			}
			await this.writeText(normalized, await this.readText(normalized));
			return;
		}
		await this.writeText(normalized, "");
	}

	private async mkdirp(path: string): Promise<void> {
		const normalized = normalizeWorkspacePath(path);
		if (normalized === "/") {
			return;
		}
		let current = "";
		for (const segment of normalized.split("/").filter(Boolean)) {
			current = `${current}/${segment}`;
			try {
				await this.fs.mkdir(current);
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
}

function isNotFound(error: unknown): boolean {
	return error instanceof WorkspaceFsError && error.code === "not_found";
}
