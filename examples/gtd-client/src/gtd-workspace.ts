import type { ThetaWorkspace } from "../../../src/index.ts";
import type { ProjectRecord } from "./app-model.ts";
import { formatWorkspaceName } from "./workspace-runtime.ts";

export function gtdRoutingInstructions(input: string): string {
	return [
		"The previous message is what the user actually said. Respond to it conversationally.",
		"Use the workspace files as memory and structure, not as a database to mechanically classify every phrase.",
		"Quietly read /AGENTS.md plus the relevant project/context files before deciding what to do.",
		"If the user asks to plan the day, read today.md, inbox.md, projects.md, active project files, waiting-for.md, someday-maybe.md, and calendar.md, then update /today.md with a draft plan before asking any question.",
		"For day planning, make reasonable choices from available information. Put uncertainty in the plan's Notes section instead of blocking on clarification.",
		"If the input is a clear next action with an obvious home, place it and briefly tell the user where it went.",
		"If the input includes a specific date or time, it belongs in calendar.md. Examples: sauna at 7:15 today, dentist tomorrow at 2pm, flight Friday morning. Do not ask whether to add these to the calendar.",
		"If it is not clear, ask one or two natural clarifying questions in chat. Do not invent details and do not write clarification prompts into files.",
		"New projects must be created under /projects/active/<slug>/ with info.md, tasks.md, and done.md. Never create root-level project folders.",
		"Never create or write to /tasks. Use project tasks.md, project done.md, /today.md, calendar.md, waiting-for.md, someday-maybe.md, or inbox.md.",
		"Use project done.md files for completed project history.",
		"Classify person follow-ups by domain: work/admin topics such as visa, payroll, company, client, team, deadline, or ProphecyGov belong in Work; personal relationship follow-ups belong in Social.",
		"Preserve the user's wording where useful. Keep replies short, direct, and human.",
		"",
		`User input: ${input}`,
	].join("\n");
}

export function formatWorkspacePath(path: string): string {
	return path.split("/").filter(Boolean).map(formatWorkspaceName).join(" / ");
}

export function parentPathsFor(path: string): readonly string[] {
	const parts = path.split("/").filter(Boolean);
	const parents = ["/"];
	for (let index = 0; index < parts.length - 1; index += 1) {
		parents.push(`/${parts.slice(0, index + 1).join("/")}`);
	}
	return parents;
}

export function isProjectPath(path: string): boolean {
	const parts = path.split("/").filter(Boolean);
	return (
		parts.length === 3 &&
		parts[0] === "projects" &&
		(parts[1] === "active" || parts[1] === "archived")
	);
}

export function projectRecordFromPath(path: string): ProjectRecord {
	const parts = path.split("/").filter(Boolean);
	const status = parts[1] === "archived" ? "archived" : "active";
	const slug = parts[2] ?? "project";
	return {
		path,
		slug,
		name: formatWorkspaceName(slug),
		status,
		infoPath: `${path}/info.md`,
		tasksPath: `${path}/tasks.md`,
	};
}

export function upsertProjectIndexLine(
	text: string,
	slug: string,
	name: string,
): string {
	const withoutProject = removeProjectIndexLine(text, slug).trimEnd();
	return `${withoutProject}\n- ${slug}: ${name}\n`;
}

export function removeProjectIndexLine(text: string, slug: string): string {
	const pattern = new RegExp(`^\\s*-\\s+${escapeRegExp(slug)}\\s*:`, "u");
	return `${text
		.split("\n")
		.filter((line) => !pattern.test(line))
		.join("\n")
		.trimEnd()}\n`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export async function deleteRecursive(
	workspace: ThetaWorkspace,
	path: string,
): Promise<void> {
	const stat = await workspace.fs.stat(path);
	if (stat.kind === "directory") {
		const entries = await workspace.fs.readdir(path);
		for (const entry of entries) {
			await deleteRecursive(workspace, entry.path);
		}
	}
	await workspace.fs.delete(path);
}

export async function moveRecursive(
	workspace: ThetaWorkspace,
	from: string,
	to: string,
): Promise<void> {
	await copyRecursive(workspace, from, to);
	await deleteRecursive(workspace, from);
}

async function copyRecursive(
	workspace: ThetaWorkspace,
	from: string,
	to: string,
): Promise<void> {
	const stat = await workspace.fs.stat(from);
	if (stat.kind === "directory") {
		await workspace.fs.mkdir(to);
		const entries = await workspace.fs.readdir(from);
		for (const entry of entries) {
			await copyRecursive(workspace, entry.path, `${to}/${entry.name}`);
		}
		return;
	}
	await workspace.fs.writeFile(to, await workspace.fs.readFile(from), {
		...(stat.mimeType ? { mimeType: stat.mimeType } : {}),
		...(stat.metadata ? { metadata: stat.metadata } : {}),
	});
}

export function slugifyProjectName(name: string): string {
	return (
		name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/gu, "-")
			.replace(/^-|-$/gu, "") || "project"
	);
}
