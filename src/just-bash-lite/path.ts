export function normalizeShellPath(path: string): string {
	if (path.length === 0 || path === ".") {
		return "/";
	}
	const parts: string[] = [];
	for (const rawPart of path.split("/")) {
		if (rawPart === "" || rawPart === ".") {
			continue;
		}
		if (rawPart === "..") {
			parts.pop();
			continue;
		}
		parts.push(rawPart);
	}
	return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function resolveShellPath(cwd: string, path: string): string {
	if (path.length === 0) {
		return normalizeShellPath(cwd);
	}
	if (path.startsWith("/")) {
		return normalizeShellPath(path);
	}
	return normalizeShellPath(`${cwd}/${path}`);
}

export function joinShellPath(parent: string, child: string): string {
	return resolveShellPath(parent, child);
}

export function dirnameShellPath(path: string): string {
	const normalized = normalizeShellPath(path);
	if (normalized === "/") {
		return "/";
	}
	const index = normalized.lastIndexOf("/");
	return index <= 0 ? "/" : normalized.slice(0, index);
}

export function basenameShellPath(path: string): string {
	const normalized = normalizeShellPath(path);
	if (normalized === "/") {
		return "/";
	}
	return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function isDescendantShellPath(parent: string, child: string): boolean {
	const normalizedParent = normalizeShellPath(parent);
	const normalizedChild = normalizeShellPath(child);
	return (
		normalizedParent !== normalizedChild &&
		normalizedChild.startsWith(`${normalizedParent}/`)
	);
}

export function toRelativeShellPath(path: string, cwd = "/"): string {
	const normalized = normalizeShellPath(path);
	const normalizedCwd = normalizeShellPath(cwd);
	if (normalized === normalizedCwd) {
		return ".";
	}
	if (normalizedCwd === "/") {
		return normalized.slice(1);
	}
	return normalized.startsWith(`${normalizedCwd}/`)
		? normalized.slice(normalizedCwd.length + 1)
		: normalized;
}
