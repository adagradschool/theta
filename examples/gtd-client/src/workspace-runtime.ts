import { PGliteWorker } from "@electric-sql/pglite/worker";

import {
	BlobNotFoundError,
	createLocalWorkspaceFs,
	createOpfsBlobCache,
	createPGliteThetaSessionStore,
	createPGliteWorkspaceMetadataStore,
	createThetaAgent,
	createThetaBrowserTools,
	createThetaSessionManager,
	createThetaWorkspace,
	type BlobCache,
	type FileStat,
	type PGliteWorkspaceMetadataStore,
	type ThetaAgent,
	type ThetaWorkspace,
} from "../../../src/index.ts";
import {
	SESSION_ID,
	STORAGE_KEY_MODEL,
	STORAGE_KEY_OPENAI,
	WORKSPACE_ID,
	starterProjects,
	type StarterProject,
} from "./app-model.ts";

export type ReadyState = {
	readonly workspace: ThetaWorkspace;
	readonly agent: ThetaAgent;
	readonly database: Pick<PGliteWorker, "close">;
	readonly providerEnv: { OPENAI_API_KEY: string };
	readonly initialEntries: readonly FileStat[];
	readonly releaseStorageLock: () => void;
};
export function formatWorkspaceName(name: string): string {
	const cleaned = name.replace(/\.md$/u, "").replaceAll("-", " ");
	return cleaned
		.split(" ")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function toDateKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function slugifyProjectName(name: string): string {
	return (
		name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/gu, "-")
			.replace(/^-|-$/gu, "") || "project"
	);
}

function upsertProjectIndexLine(
	text: string,
	slug: string,
	name: string,
): string {
	const withoutProject = removeProjectIndexLine(text, slug).trimEnd();
	return `${withoutProject}\n- ${slug}: ${name}\n`;
}

function removeProjectIndexLine(text: string, slug: string): string {
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
export async function initialize(): Promise<ReadyState> {
	const releaseStorageLock = await acquireStorageLock();
	try {
		const pg = await PGliteWorker.create(
			new Worker(new URL("./pglite-worker.ts", import.meta.url), {
				type: "module",
			}),
			{ dataDir: "opfs-ahp://theta-gtd-client" },
		);
		await pg.waitReady;
		const metadata = createPGliteWorkspaceMetadataStore(pg);
		const sessions = createPGliteThetaSessionStore({ pg, metadata });
		const blobs = createOpfsBlobCache({ rootName: "theta-gtd-client-blobs" });
		await repairMissingContentBlobMetadata(metadata, blobs);
		const fs = createLocalWorkspaceFs({
			workspaceId: WORKSPACE_ID,
			metadata,
			blobs,
			deviceId: "browser",
		});
		const workspace = createThetaWorkspace({
			id: WORKSPACE_ID,
			name: "donedone Workspace",
			fs,
			tools: [
				createThetaBrowserTools({
					bash: {
						timeoutMs: 8000,
						env: { THETA_EXAMPLE: "gtd-client" },
						customCommands: [
							{
								name: "date",
								async execute() {
									return {
										stdout: `${new Date().toString()}\n`,
										stderr: "",
										exitCode: 0,
									};
								},
							},
						],
					},
				}),
			],
		});
		const manager = createThetaSessionManager({ store: sessions });
		const existing = await manager.getSession(SESSION_ID);
		if (!existing) {
			await manager.createSession({
				id: SESSION_ID,
				workspaceId: WORKSPACE_ID,
				title: "GTD Client Session",
			});
		}
		await seedGtdWorkspace(fs);
		const providerEnv = {
			OPENAI_API_KEY: localStorage.getItem(STORAGE_KEY_OPENAI) ?? "",
		};
		const agent = createThetaAgent({
			id: "theta-gtd-agent",
			workspace,
			systemPrompt: [
				"You are donedone, a calm GTD assistant for a busy professional.",
				"Your job is to help the user think clearly, not to behave like a filing robot.",
				"Before changing workspace files, read /AGENTS.md and follow it.",
				"Use the workspace files as the shared memory: /AGENTS.md, inbox.md, /today.md, projects.md, project info/tasks/done files, waiting-for.md, someday-maybe.md, calendar.md, and reference files.",
				"Be conversational, but do not ask unnecessary questions when the capture is obvious.",
				"When the user asks for a plan, produce a plan from the workspace first. Do not ask which project to focus on before drafting.",
				"For daily planning, read calendar.md, today.md, inbox.md, waiting-for.md, someday-maybe.md, and active project files, then write /today.md with a useful draft. Put uncertainty in Notes.",
				"Only auto-file when the next action, destination project/system file, and context are genuinely obvious.",
				"Specific date/time commitments go to calendar.md without asking for confirmation.",
				"After changing files, say plainly what changed and what, if anything, still needs the user's attention.",
				"New projects must be created under /projects/active/<slug>/ with info.md, tasks.md, and done.md. Never create root-level project folders.",
				"Never create or use /tasks. It is not part of this workspace model.",
				"Use /today.md for the current day plan.",
				"Use each project's done.md to preserve completed project history.",
				"Classify person follow-ups by domain: work/admin topics such as visa, payroll, company, client, team, deadline, or ProphecyGov belong in Work; personal relationship follow-ups belong in Social.",
				"Never remove an inbox line unless you processed it correctly or the user explicitly told you to remove it.",
				"Do not pretend to ask questions by writing clarification notes into files. Ask in the chat.",
				"Do not call external Todoist or calendar services in this client-side BYOK example.",
			].join("\n"),
			model: {
				provider: "openai",
				api: "openai-responses",
				id: localStorage.getItem(STORAGE_KEY_MODEL) ?? "gpt-4.1-mini",
				contextWindow: 128_000,
				maxOutputTokens: 4096,
				supports: { text: true, tools: true },
			},
			runtimeOptions: {
				providerEnv,
			},
			session: {
				manager,
				sessionId: SESSION_ID,
				persistMessages: true,
			},
		});
		await agent.restoreSession();
		const initialEntries = await collectKnownWorkspaceStats(workspace);
		return {
			workspace,
			agent,
			database: pg,
			providerEnv,
			initialEntries,
			releaseStorageLock,
		};
	} catch (error) {
		releaseStorageLock();
		throw error;
	}
}

export async function disposeReadyState(state: ReadyState) {
	state.agent.dispose();
	state.workspace.dispose();
	await state.database.close();
	state.releaseStorageLock();
}

export async function deleteOpfsAppState(): Promise<void> {
	await Promise.all([
		deleteOpfsEntry("theta-gtd-client"),
		deleteOpfsEntry("theta-gtd-client-blobs"),
	]);
}

async function deleteOpfsEntry(name: string): Promise<void> {
	if (!navigator.storage?.getDirectory) {
		return;
	}
	const root = await navigator.storage.getDirectory();
	try {
		await root.removeEntry(name, { recursive: true });
	} catch (error) {
		if (!(error instanceof DOMException && error.name === "NotFoundError")) {
			throw error;
		}
	}
}

async function acquireStorageLock(): Promise<() => void> {
	if (!("locks" in navigator)) {
		return () => {};
	}

	let releaseHold: (() => void) | undefined;
	const hold = new Promise<void>((resolve) => {
		releaseHold = resolve;
	});
	const acquired = new Promise<() => void>((resolve, reject) => {
		void navigator.locks
			.request("theta-gtd-client-opfs", { ifAvailable: true }, async (lock) => {
				if (!lock) {
					reject(
						new Error(
							"donedone is already open in another tab. Close the other tab, then reload this one.",
						),
					);
					return;
				}
				resolve(() => releaseHold?.());
				await hold;
			})
			.catch(reject);
	});

	return acquired;
}

async function seedGtdWorkspace(fs: ThetaWorkspace["fs"]): Promise<void> {
	await ensureDirectory(fs, "/weekly");
	await ensureDirectory(fs, "/projects");
	await ensureDirectory(fs, "/projects/active");
	await ensureDirectory(fs, "/projects/archived");
	await ensureDirectory(fs, "/reference");
	await migrateTodayFile(fs);
	await deleteIfExists(fs, "/daily");
	await pruneUnsupportedProjectTaskFiles(fs);
	for (const project of starterProjects) {
		const projectPath = `/projects/active/${project.slug}`;
		await ensureDirectory(fs, projectPath);
		await ensureTextFile(
			fs,
			`${projectPath}/info.md`,
			starterProjectInfo(project),
		);
		await ensureTextFile(
			fs,
			`${projectPath}/tasks.md`,
			starterProjectTasks(project),
		);
		await ensureTextFile(
			fs,
			`${projectPath}/done.md`,
			starterProjectDone(project),
		);
	}
	await migrateUnsupportedTaskFolder(fs);
	await ensureTextFile(
		fs,
		"/inbox.md",
		[
			"# Inbox",
			"",
			"Capture anything here when it is not yet clear where it belongs.",
			"",
		].join("\n"),
	);
	await ensureTextFile(
		fs,
		"/projects.md",
		[
			"# Projects",
			"",
			...starterProjects.map((project) => `- ${project.slug}: ${project.name}`),
			"",
		].join("\n"),
	);
	await fs.writeTextFile("/AGENTS.md", workspaceAgentsInstructions(), {
		mimeType: "text/markdown",
	});
	await ensureTextFile(fs, "/waiting-for.md", "# Waiting For\n\n");
	await ensureTextFile(fs, "/someday-maybe.md", "# Someday/Maybe\n\n");
	await ensureTextFile(fs, "/calendar.md", "# Calendar\n\n");
	await ensureTextFile(fs, "/today.md", todayPlanTemplate(new Date()));
	await ensureTextFile(fs, "/reference/contexts.md", starterContexts());
	await ensureTextFile(
		fs,
		"/reference/gtd-workflow.md",
		[
			"# GTD Workflow",
			"",
			"Clear single actions can go directly into project task files when project and context are obvious.",
			"Completed project work belongs in that project's done.md.",
			"Ambiguous captures should stay in inbox.md until the user answers a chat question.",
			"Do not replace a user question with a note in inbox.md. Ask the question in the session.",
			"Daily planning should write to /today.md after reading active projects, waiting-for, calendar, and inbox.",
			"Do not create a top-level /tasks folder. Actions belong in project task files, today.md, calendar.md, waiting-for.md, someday-maybe.md, or inbox.md.",
			"New projects must live under /projects/active/<slug>/ and include info.md, tasks.md, and done.md.",
			"",
		].join("\n"),
	);
	await migrateRootProjectDirectories(fs);
	await ensureStarterProjectIndex(fs);
}

async function migrateUnsupportedTaskFolder(
	fs: ThetaWorkspace["fs"],
): Promise<void> {
	try {
		await fs.stat("/tasks");
	} catch {
		return;
	}
	const entries = await fs.readdir("/tasks");
	for (const entry of entries) {
		if (entry.kind === "directory") {
			await migrateUnsupportedTaskDirectory(fs, entry.path);
			continue;
		}
		if (entry.kind === "file" && entry.path.endsWith(".md")) {
			await migrateUnsupportedTaskFile(fs, entry.path);
		}
	}
	await deleteFsRecursive(fs, "/tasks");
}

async function migrateTodayFile(fs: ThetaWorkspace["fs"]): Promise<void> {
	try {
		await readTextFileIfPresent(fs, "/today.md");
		return;
	} catch {
		// Continue and look for the previous nested location.
	}
	try {
		const previous = await fs.readTextFile("/daily/today.md");
		await fs.writeTextFile("/today.md", previous, {
			mimeType: "text/markdown",
		});
	} catch {
		await fs.writeTextFile("/today.md", todayPlanTemplate(new Date()), {
			mimeType: "text/markdown",
		});
	}
}

async function pruneUnsupportedProjectTaskFiles(
	fs: ThetaWorkspace["fs"],
): Promise<void> {
	await deleteIfExists(fs, "/projects/tasks.md");
	await deleteIfExists(fs, "/projects/active/tasks.md");
	await deleteIfExists(fs, "/projects/archived/tasks.md");
}

async function deleteIfExists(
	fs: ThetaWorkspace["fs"],
	path: string,
): Promise<void> {
	try {
		await fs.stat(path);
	} catch {
		return;
	}
	await deleteFsRecursive(fs, path);
}

async function migrateRootProjectDirectories(
	fs: ThetaWorkspace["fs"],
): Promise<void> {
	const entries = await fs.readdir("/");
	for (const entry of entries) {
		if (entry.kind !== "directory" || !isRootProjectDirectory(entry.path)) {
			continue;
		}
		const rootName = entry.path.split("/").filter(Boolean)[0];
		if (!rootName) {
			continue;
		}
		const name = formatWorkspaceName(rootName);
		const slug = slugifyProjectName(name);
		const targetPath = `/projects/active/${slug}`;
		await copyFsRecursive(fs, entry.path, targetPath);
		await ensureProjectScaffold(fs, targetPath, name);
		const currentProjects = await fs.readTextFile("/projects.md");
		await fs.writeTextFile(
			"/projects.md",
			upsertProjectIndexLine(currentProjects, slug, name),
			{ mimeType: "text/markdown" },
		);
		await deleteFsRecursive(fs, entry.path);
	}
}

function isRootProjectDirectory(path: string): boolean {
	const name = path.split("/").filter(Boolean)[0];
	return (
		name !== undefined &&
		!new Set(["projects", "reference", "weekly"]).has(name.toLowerCase())
	);
}

async function copyFsRecursive(
	fs: ThetaWorkspace["fs"],
	from: string,
	to: string,
): Promise<void> {
	const stat = await fs.stat(from);
	if (stat.kind === "directory") {
		await ensureDirectory(fs, to);
		const entries = await fs.readdir(from);
		for (const entry of entries) {
			const entryName = entry.path.split("/").filter(Boolean).at(-1);
			if (!entryName) {
				continue;
			}
			await copyFsRecursive(fs, entry.path, `${to}/${entryName}`);
		}
		return;
	}
	const text = await readTextFileIfPresent(fs, from);
	await fs.writeTextFile(to, text, { mimeType: "text/markdown" });
}

async function ensureProjectScaffold(
	fs: ThetaWorkspace["fs"],
	projectPath: string,
	name: string,
): Promise<void> {
	await ensureDirectory(fs, projectPath);
	await ensureTextFile(
		fs,
		`${projectPath}/info.md`,
		[`# ${name}`, "", "## Outcome", "", "## Notes", ""].join("\n"),
	);
	await ensureTextFile(
		fs,
		`${projectPath}/tasks.md`,
		[`# ${name} Tasks`, "", "## Next Actions", ""].join("\n"),
	);
	await ensureTextFile(
		fs,
		`${projectPath}/done.md`,
		[`# ${name} Done`, "", "## Completed", ""].join("\n"),
	);
}

async function migrateUnsupportedTaskDirectory(
	fs: ThetaWorkspace["fs"],
	path: string,
): Promise<void> {
	const entries = await fs.readdir(path);
	for (const entry of entries) {
		if (entry.kind === "directory") {
			await migrateUnsupportedTaskDirectory(fs, entry.path);
			continue;
		}
		if (entry.kind === "file" && entry.path.endsWith(".md")) {
			await migrateUnsupportedTaskFile(fs, entry.path);
		}
	}
}

async function migrateUnsupportedTaskFile(
	fs: ThetaWorkspace["fs"],
	path: string,
): Promise<void> {
	const sourceName = formatWorkspaceName(
		path.split("/").filter(Boolean).at(-2) ?? path.split("/").at(-1) ?? "Task",
	);
	const text = await fs.readTextFile(path);
	for (const task of extractTaskLines(text)) {
		const target = classifyMigratedTask(`${sourceName} ${task}`);
		await appendTaskToProjectContext(
			fs,
			target.projectSlug,
			target.context,
			task,
		);
	}
}

function extractTaskLines(text: string): readonly string[] {
	return text
		.split("\n")
		.map((line) =>
			line
				.replace(/^\s*-\s+\[[ xX]\]\s*/u, "")
				.replace(/^\s*-\s*/u, "")
				.trim(),
		)
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

function classifyMigratedTask(text: string): {
	readonly projectSlug: "work" | "social";
	readonly context: "@work-calls" | "@agenda-person";
} {
	return /\b(visa|payroll|prophecygov|company|client|team|deadline|proposal|office|work)\b/iu.test(
		text,
	)
		? { projectSlug: "work", context: "@work-calls" }
		: { projectSlug: "social", context: "@agenda-person" };
}

async function appendTaskToProjectContext(
	fs: ThetaWorkspace["fs"],
	projectSlug: "work" | "social",
	context: "@work-calls" | "@agenda-person",
	task: string,
): Promise<void> {
	const path = `/projects/active/${projectSlug}/tasks.md`;
	const current = await fs.readTextFile(path);
	await fs.writeTextFile(path, appendTaskUnderContext(current, context, task), {
		mimeType: "text/markdown",
	});
}

function appendTaskUnderContext(
	text: string,
	context: string,
	task: string,
): string {
	const lines = text.trimEnd().split("\n");
	const heading = contextHeader(context);
	const headingIndex = lines.findIndex((line) => line.trim() === heading);
	const taskLine = `- [ ] ${task}`;
	if (headingIndex === -1) {
		return `${lines.join("\n")}\n\n${heading}\n${taskLine}\n`;
	}
	const nextHeadingIndex = lines.findIndex(
		(line, index) => index > headingIndex && /^##\s+/u.test(line),
	);
	const insertIndex = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;
	lines.splice(insertIndex, 0, taskLine);
	return `${lines.join("\n")}\n`;
}

async function deleteFsRecursive(
	fs: ThetaWorkspace["fs"],
	path: string,
): Promise<void> {
	const stat = await fs.stat(path);
	if (stat.kind === "directory") {
		const entries = await fs.readdir(path);
		for (const entry of entries) {
			await deleteFsRecursive(fs, entry.path);
		}
	}
	await fs.delete(path);
}

async function ensureStarterProjectIndex(fs: ThetaWorkspace["fs"]) {
	let current = await readTextFileIfPresent(fs, "/projects.md");
	for (const project of starterProjects) {
		current = upsertProjectIndexLine(current, project.slug, project.name);
	}
	await fs.writeTextFile("/projects.md", current, {
		mimeType: "text/markdown",
	});
}

function starterProjectInfo(project: StarterProject): string {
	return [
		`# ${project.name}`,
		"",
		"## Outcome",
		project.outcome,
		"",
		"## Intake cues",
		...project.intakeCues.map((cue) => `- ${cue}`),
		"",
		"## Processing rule",
		"Move captures here only when the outcome and next action clearly match this project. Otherwise ask the user in chat.",
		"",
	].join("\n");
}

function starterProjectTasks(project: StarterProject): string {
	return [
		`# ${project.name} Tasks`,
		"",
		...project.contexts.flatMap((context) => [contextHeader(context), ""]),
	].join("\n");
}

function starterProjectDone(project: StarterProject): string {
	return [`# ${project.name} Done`, "", "## Completed", ""].join("\n");
}

function workspaceAgentsInstructions(): string {
	return [
		"# donedone Agent Instructions",
		"",
		"You are donedone, a GTD assistant for this workspace.",
		"",
		"Work conversationally, but do the obvious thing without asking.",
		"Read this file before changing workspace files.",
		"",
		"## Workspace layout",
		"",
		"- /inbox.md: unclear captures",
		"- /today.md: today's plan",
		"- /calendar.md: dated or timed commitments",
		"- /waiting-for.md: delegated or waiting items",
		"- /someday-maybe.md: future possibilities",
		"- /projects.md: project index",
		"- /projects/active/<slug>/info.md: project outcome and context",
		"- /projects/active/<slug>/tasks.md: active next actions",
		"- /projects/active/<slug>/done.md: completed project history",
		"- /projects/archived/<slug>/: completed or inactive projects",
		"- /reference/: non-actionable support material",
		"",
		"## Project rules",
		"",
		"New projects are always directories under /projects/active/<slug>/.",
		"Never create project folders at the workspace root.",
		"A project directory must have info.md, tasks.md, and done.md.",
		"Do not create /tasks or /daily.",
		"",
		"## Routing rules",
		"",
		"- Specific date/time commitments go to /calendar.md.",
		"- Daily planning means write /today.md from available workspace information first; ask only after the draft exists.",
		"- Do not ask which project to focus on when active project files already contain enough tasks to suggest a day.",
		"- Clear work/admin follow-ups go to Work.",
		"- Clear personal relationship follow-ups go to Social.",
		"- Ask in chat only when project, outcome, context, or action is genuinely ambiguous.",
		"",
	].join("\n");
}

function contextHeader(context: string): string {
	return `## ${context}`;
}

function starterContexts(): string {
	return [
		"# Contexts",
		"",
		"Use contexts to decide where a clear next action belongs. If context is unclear, ask in chat before editing files.",
		"",
		"- @work-computer: focused work on a computer",
		"- @work-calls: work calls, messages, and meeting follow-ups",
		"- @work-errand: work errands outside the computer",
		"- @home-computer: personal admin on a computer",
		"- @home-calls: personal calls, messages, appointments",
		"- @physical: exercise, body maintenance, health routines",
		"- @social: relationship follow-through, social plans, replies, gifts",
		"- @errands: out-of-home actions",
		"- @agenda-person: something to discuss with a specific person",
		"",
		"Auto-processing checklist:",
		"- Is it a single physical action?",
		"- Is the target project obvious from projects/active/*/info.md?",
		"- Is the context obvious?",
		"- Is the action complete enough to do without another question?",
		"",
		"If any answer is no, ask the user in the chat and leave the inbox line unchanged.",
		"",
	].join("\n");
}

function todayPlanTemplate(date: Date): string {
	return [
		`# Today - ${toDateKey(date)}`,
		"",
		"## Must do",
		"",
		"## Work",
		"",
		"## Social",
		"",
		"## Errands",
		"",
		"## Physical",
		"",
		"## Waiting",
		"",
		"## Notes",
		"",
	].join("\n");
}

export async function collectWorkspaceStats(
	workspace: ThetaWorkspace,
	path = "/",
): Promise<readonly FileStat[]> {
	const recursive = await collectWorkspaceStatsFromDirectory(workspace, path);
	if (recursive.length > 0 || path !== "/") {
		return recursive;
	}
	return collectKnownWorkspaceStats(workspace);
}

async function collectWorkspaceStatsFromDirectory(
	workspace: ThetaWorkspace,
	path: string,
): Promise<readonly FileStat[]> {
	const entries = await workspace.fs.readdir(path);
	const stats: FileStat[] = [];
	for (const entry of entries) {
		if (entry.path === path) {
			continue;
		}
		const stat = entry.stat ?? (await workspace.fs.stat(entry.path));
		stats.push(stat);
		if (entry.kind === "directory") {
			stats.push(
				...(await collectWorkspaceStatsFromDirectory(workspace, entry.path)),
			);
		}
	}
	return stats;
}

async function collectKnownWorkspaceStats(
	workspace: ThetaWorkspace,
): Promise<readonly FileStat[]> {
	const paths = [
		"/weekly",
		"/projects",
		"/projects/active",
		"/projects/archived",
		"/reference",
		"/AGENTS.md",
		"/inbox.md",
		"/projects.md",
		"/waiting-for.md",
		"/someday-maybe.md",
		"/calendar.md",
		"/today.md",
		"/reference/contexts.md",
		"/reference/gtd-workflow.md",
		"/today-smoke.md",
	];
	for (const project of starterProjects) {
		paths.push(
			`/projects/active/${project.slug}`,
			`/projects/active/${project.slug}/info.md`,
			`/projects/active/${project.slug}/tasks.md`,
			`/projects/active/${project.slug}/done.md`,
		);
	}
	const stats: FileStat[] = [];
	for (const path of paths) {
		try {
			stats.push(await workspace.fs.stat(path));
		} catch {
			// Optional seed files may not exist yet.
		}
	}
	return stats;
}

async function ensureDirectory(fs: ThetaWorkspace["fs"], path: string) {
	try {
		await fs.mkdir(path);
	} catch {
		// Existing directories are fine for seed data.
	}
}

async function ensureTextFile(
	fs: ThetaWorkspace["fs"],
	path: string,
	text: string,
) {
	try {
		const stat = await fs.stat(path);
		if (stat.kind === "file") {
			await fs.readFile(path);
		}
	} catch {
		await fs.writeTextFile(path, text, { mimeType: "text/markdown" });
	}
}

async function readTextFileIfPresent(
	fs: ThetaWorkspace["fs"],
	path: string,
): Promise<string> {
	try {
		return await fs.readTextFile(path);
	} catch (error) {
		if (isMissingContentBlob(error)) {
			await fs.delete(path);
		}
		throw error;
	}
}

function isMissingContentBlob(error: unknown): boolean {
	return (
		error instanceof BlobNotFoundError ||
		(error instanceof Error &&
			error.message.startsWith("Content blob not found:"))
	);
}

async function repairMissingContentBlobMetadata(
	metadata: PGliteWorkspaceMetadataStore,
	blobs: BlobCache,
): Promise<void> {
	const entries = await metadata.listEntries(WORKSPACE_ID);
	for (const entry of entries) {
		if (entry.kind !== "file" || !entry.contentHash) {
			continue;
		}
		const hasBlob = await withTimeout(
			blobs.has(entry.contentHash),
			3000,
			false,
		);
		if (!hasBlob) {
			await metadata.deleteEntry(WORKSPACE_ID, entry.path);
		}
	}
}

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	fallback: T,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => resolve(fallback), timeoutMs);
		promise.then(
			(value) => {
				window.clearTimeout(timeout);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timeout);
				reject(error);
			},
		);
	});
}
