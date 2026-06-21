export function matchesShellGlob(path: string, pattern: string): boolean {
	return shellGlobToRegExp(pattern).test(path);
}

export function shellGlobToRegExp(pattern: string): RegExp {
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
			continue;
		}
		if (char === "*") {
			source += "[^/]*";
			continue;
		}
		if (char === "?") {
			source += "[^/]";
			continue;
		}
		source += escapeRegExp(char ?? "");
	}
	source += "$";
	return new RegExp(source);
}

function escapeRegExp(value: string): string {
	return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
