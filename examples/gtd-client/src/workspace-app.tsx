import { useEffect, useState, type FormEvent } from "react";

import type {
	FileStat,
	ThetaAgent,
	ThetaWorkspace,
} from "../../../src/index.ts";
import {
	useThetaChat,
	useThetaEditorFile,
	useThetaFileTree,
	useThetaProgress,
} from "../../../src/react.ts";
import {
	STORAGE_KEY_MODEL,
	STORAGE_KEY_OPENAI,
	type ProjectRecord,
} from "./app-model.ts";
import { AddItemModal } from "./add-item-modal.tsx";
import { ConversationView } from "./conversation-view.tsx";
import { FileTree } from "./file-tree.tsx";
import {
	deleteRecursive,
	formatWorkspacePath,
	gtdRoutingInstructions,
	isProjectPath,
	moveRecursive,
	parentPathsFor,
	projectRecordFromPath,
	removeProjectIndexLine,
	slugifyProjectName,
	upsertProjectIndexLine,
} from "./gtd-workspace.ts";
import { replaceMarkdownLineContent } from "./markdown-note.tsx";
import { SettingsPanel } from "./settings-panel.tsx";
import {
	Composer,
	FilePane,
	PlanningPanel,
	SystemNav,
} from "./workspace-layout.tsx";
import {
	collectWorkspaceStats,
	formatWorkspaceName,
} from "./workspace-runtime.ts";

export function WorkspaceApp(props: {
	readonly workspace: ThetaWorkspace;
	readonly agent: ThetaAgent;
	readonly providerEnv: { OPENAI_API_KEY: string };
	readonly initialEntries: readonly FileStat[];
	readonly selectedPath: string | undefined;
	readonly onSelectPath: (path: string | undefined) => void;
	readonly onNukeLocalState: () => void;
}) {
	const [treeEntries, setTreeEntries] = useState<readonly FileStat[]>(
		props.initialEntries,
	);
	const tree = useThetaFileTree(props.workspace, { entries: treeEntries });
	const editor = useThetaEditorFile(props.workspace, props.selectedPath);
	const progress = useThetaProgress(props.agent);
	const chat = useThetaChat(props.agent);
	const [captureText, setCaptureText] = useState("");
	const [newProjectName, setNewProjectName] = useState("");
	const [newTaskText, setNewTaskText] = useState("");
	const [taskTargetPath, setTaskTargetPath] = useState("/inbox.md");
	const [sidebarMessage, setSidebarMessage] = useState("");
	const [sidebarSaving, setSidebarSaving] = useState(false);
	const [expandedTreePaths, setExpandedTreePaths] = useState<
		ReadonlySet<string>
	>(() => new Set(["/", "/projects", "/projects/active"]));
	const [addModalOpen, setAddModalOpen] = useState(false);
	const [automationMessage, setAutomationMessage] = useState("");
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [apiKey, setApiKey] = useState(
		() => localStorage.getItem(STORAGE_KEY_OPENAI) ?? "",
	);
	const [model, setModel] = useState(
		() => localStorage.getItem(STORAGE_KEY_MODEL) ?? "gpt-4.1-mini",
	);

	const projects = treeEntries
		.filter((entry) => entry.kind === "directory" && isProjectPath(entry.path))
		.map((entry) => projectRecordFromPath(entry.path))
		.sort((a, b) => a.name.localeCompare(b.name));
	const activeProjects = projects.filter(
		(project) => project.status === "active",
	);
	const archivedProjects = projects.filter(
		(project) => project.status === "archived",
	);
	const activeProjectOptions = activeProjects
		.map((project) => ({ path: project.tasksPath, name: project.name }))
		.sort((a, b) => a.name.localeCompare(b.name));
	const selectedName = props.selectedPath
		? formatWorkspaceName(
				props.selectedPath.split("/").at(-1) ?? props.selectedPath,
			)
		: "";
	const canRun = apiKey.trim().length > 0 && !progress.isWorking;

	useEffect(() => {
		let cancelled = false;
		void collectWorkspaceStats(props.workspace).then((entries) => {
			if (!cancelled) {
				setTreeEntries(entries);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [props.workspace]);

	useEffect(() => {
		const selectedPath = props.selectedPath;
		if (!selectedPath) {
			return;
		}
		setExpandedTreePaths((current) => {
			const next = new Set(current);
			for (const parent of parentPathsFor(selectedPath)) {
				next.add(parent);
			}
			return next;
		});
	}, [props.selectedPath]);

	useEffect(() => {
		localStorage.setItem(STORAGE_KEY_MODEL, model);
		props.agent.setModel({
			provider: "openai",
			api: "openai-responses",
			id: model,
			name: model,
			contextWindow: 128_000,
			maxOutputTokens: 4096,
			supports: { text: true, tools: true },
		});
	}, [props.agent, model]);

	useEffect(() => {
		if (apiKey) {
			localStorage.setItem(STORAGE_KEY_OPENAI, apiKey);
		} else {
			localStorage.removeItem(STORAGE_KEY_OPENAI);
		}
		props.providerEnv.OPENAI_API_KEY = apiKey;
	}, [apiKey, props.providerEnv]);

	async function refreshWorkspace() {
		setTreeEntries(await collectWorkspaceStats(props.workspace));
		if (props.selectedPath) {
			await editor.reload();
		}
	}

	async function captureCommitment(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const content = captureText.trim();
		if (!content) {
			return;
		}
		if (canRun) {
			setCaptureText("");
			setAutomationMessage("donedone is figuring out where this belongs...");
			await props.agent.prompt([
				{ role: "user", content, timestamp: Date.now() },
				{
					role: "custom",
					customType: "gtd-routing-instructions",
					display: false,
					content: gtdRoutingInstructions(content),
					timestamp: Date.now(),
				},
			]);
			setAutomationMessage("donedone responded in the session.");
		} else {
			const stamp = new Date().toLocaleString();
			const current = await props.workspace.fs.readTextFile("/inbox.md");
			await props.workspace.fs.writeTextFile(
				"/inbox.md",
				`${current.trimEnd()}\n- [ ] ${stamp} - ${content}\n`,
				{ mimeType: "text/markdown" },
			);
			setCaptureText("");
			setAutomationMessage(
				apiKey.trim().length === 0
					? "Saved to Inbox. Connect donedone in Settings for automatic sorting."
					: "donedone is already working.",
			);
		}
		await refreshWorkspace();
	}

	async function clearChat() {
		if (progress.isWorking) {
			return;
		}
		await props.agent.clearSession();
		setAutomationMessage("Chat cleared.");
	}

	async function createProject(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const name = newProjectName.trim();
		if (!name || sidebarSaving) {
			return;
		}
		setSidebarSaving(true);
		try {
			const slug = slugifyProjectName(name);
			const projectPath = `/projects/active/${slug}`;
			await props.workspace.fs.mkdir(projectPath);
			await props.workspace.fs.writeTextFile(
				`${projectPath}/info.md`,
				[`# ${name}`, "", "## Outcome", "", "## Notes", ""].join("\n"),
				{ mimeType: "text/markdown" },
			);
			await props.workspace.fs.writeTextFile(
				`${projectPath}/tasks.md`,
				[`# ${name} Tasks`, "", "## Next Actions", ""].join("\n"),
				{ mimeType: "text/markdown" },
			);
			await props.workspace.fs.writeTextFile(
				`${projectPath}/done.md`,
				[`# ${name} Done`, "", "## Completed", ""].join("\n"),
				{ mimeType: "text/markdown" },
			);
			const currentProjects =
				await props.workspace.fs.readTextFile("/projects.md");
			await props.workspace.fs.writeTextFile(
				"/projects.md",
				upsertProjectIndexLine(currentProjects, slug, name),
				{ mimeType: "text/markdown" },
			);
			setNewProjectName("");
			setTaskTargetPath(`${projectPath}/tasks.md`);
			setSidebarMessage(`Created ${name}.`);
			props.onSelectPath(`${projectPath}/tasks.md`);
			expandPaths(["/projects", "/projects/active", projectPath]);
			await refreshWorkspace();
		} catch (error) {
			console.error(error);
			setSidebarMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setSidebarSaving(false);
		}
	}

	async function createTask(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const text = newTaskText.trim();
		if (!text || sidebarSaving) {
			return;
		}
		setSidebarSaving(true);
		try {
			const current = await props.workspace.fs.readTextFile(taskTargetPath);
			await props.workspace.fs.writeTextFile(
				taskTargetPath,
				`${current.trimEnd()}\n- [ ] ${text}\n`,
				{ mimeType: "text/markdown" },
			);
			setNewTaskText("");
			setSidebarMessage(
				`Added task to ${formatWorkspacePath(taskTargetPath)}.`,
			);
			props.onSelectPath(taskTargetPath);
			await refreshWorkspace();
		} catch (error) {
			setSidebarMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setSidebarSaving(false);
		}
	}

	async function renameProject(project: ProjectRecord) {
		const nextName = window.prompt("Rename project", project.name)?.trim();
		if (!nextName || nextName === project.name || sidebarSaving) {
			return;
		}
		await mutateProject(`Renamed ${project.name} to ${nextName}.`, async () => {
			const nextSlug = slugifyProjectName(nextName);
			const nextPath = `/projects/${project.status}/${nextSlug}`;
			await moveRecursive(props.workspace, project.path, nextPath);
			const currentProjects =
				await props.workspace.fs.readTextFile("/projects.md");
			await props.workspace.fs.writeTextFile(
				"/projects.md",
				project.status === "active"
					? upsertProjectIndexLine(
							removeProjectIndexLine(currentProjects, project.slug),
							nextSlug,
							nextName,
						)
					: removeProjectIndexLine(currentProjects, project.slug),
				{ mimeType: "text/markdown" },
			);
			expandPaths(["/projects", `/projects/${project.status}`, nextPath]);
		});
	}

	async function archiveProject(project: ProjectRecord) {
		if (project.status !== "active") {
			return;
		}
		await mutateProject(`Archived ${project.name}.`, async () => {
			const targetPath = `/projects/archived/${project.slug}`;
			await moveRecursive(props.workspace, project.path, targetPath);
			const currentProjects =
				await props.workspace.fs.readTextFile("/projects.md");
			await props.workspace.fs.writeTextFile(
				"/projects.md",
				removeProjectIndexLine(currentProjects, project.slug),
				{ mimeType: "text/markdown" },
			);
			if (props.selectedPath?.startsWith(project.path)) {
				props.onSelectPath(undefined);
			}
		});
	}

	async function restoreProject(project: ProjectRecord) {
		if (project.status !== "archived") {
			return;
		}
		await mutateProject(`Restored ${project.name}.`, async () => {
			const targetPath = `/projects/active/${project.slug}`;
			await moveRecursive(props.workspace, project.path, targetPath);
			const currentProjects =
				await props.workspace.fs.readTextFile("/projects.md");
			await props.workspace.fs.writeTextFile(
				"/projects.md",
				upsertProjectIndexLine(currentProjects, project.slug, project.name),
				{ mimeType: "text/markdown" },
			);
			expandPaths(["/projects", "/projects/active", targetPath]);
		});
	}

	async function deleteProject(project: ProjectRecord) {
		if (
			sidebarSaving ||
			!window.confirm(`Delete ${project.name}? This removes its files.`)
		) {
			return;
		}
		await mutateProject(`Deleted ${project.name}.`, async () => {
			await deleteRecursive(props.workspace, project.path);
			const currentProjects =
				await props.workspace.fs.readTextFile("/projects.md");
			await props.workspace.fs.writeTextFile(
				"/projects.md",
				removeProjectIndexLine(currentProjects, project.slug),
				{ mimeType: "text/markdown" },
			);
			if (props.selectedPath?.startsWith(project.path)) {
				props.onSelectPath(undefined);
			}
		});
	}

	async function mutateProject(
		message: string,
		operation: () => Promise<void>,
	) {
		if (sidebarSaving) {
			return;
		}
		setSidebarSaving(true);
		try {
			await operation();
			await refreshWorkspace();
			setSidebarMessage(message);
		} catch (error) {
			console.error(error);
			setSidebarMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setSidebarSaving(false);
		}
	}

	function expandPaths(paths: readonly string[]) {
		setExpandedTreePaths((current) => {
			const next = new Set(current);
			for (const path of paths) {
				next.add(path);
			}
			return next;
		});
	}

	async function toggleTaskLine(lineIndex: number, checked: boolean) {
		const lines = editor.text.split("\n");
		const line = lines[lineIndex];
		if (line === undefined) {
			return;
		}
		lines[lineIndex] = line.replace(
			/^(\s*)- \[[ xX]\](\s+.*)$/u,
			`$1- [${checked ? "x" : " "}]$2`,
		);
		const nextText = lines.join("\n");
		editor.setText(nextText);
		await editor.save(nextText);
	}

	async function updateMarkdownLine(lineIndex: number, nextContent: string) {
		const lines = editor.text.split("\n");
		const line = lines[lineIndex];
		if (line === undefined) {
			return;
		}
		const nextLine = replaceMarkdownLineContent(line, nextContent);
		if (nextLine === line) {
			return;
		}
		lines[lineIndex] = nextLine;
		const nextText = lines.join("\n");
		editor.setText(nextText);
		await editor.save(nextText);
	}

	async function runPlaybook(instruction: string) {
		if (!canRun) {
			setAutomationMessage(
				apiKey.trim().length === 0
					? "Add your OpenAI key to let donedone organize this workspace."
					: "donedone is already working.",
			);
			return;
		}
		setAutomationMessage("donedone is organizing the workspace...");
		await props.agent.prompt(instruction);
		setAutomationMessage("Automation finished. Review the updated files.");
		await refreshWorkspace();
	}

	return (
		<div className="workspace-shell">
			<header className="topbar">
				<div className="brand-lockup">
					<div className="brand-mark">d</div>
					<h1>donedone</h1>
				</div>
				<button
					type="button"
					className="settings-button"
					onClick={() => setSettingsOpen(true)}
				>
					Settings
				</button>
			</header>

			<main className="layout">
				<aside className="sidebar">
					<section className="sidebar-section">
						<div className="section-heading">
							<h2>Focus</h2>
							<span>Today</span>
						</div>
						<SystemNav
							activeProjectCount={activeProjects.length}
							onSelectPath={props.onSelectPath}
							onAdd={() => setAddModalOpen(true)}
						/>
					</section>
					<section className="sidebar-section">
						<div className="section-heading">
							<h2>Workspace</h2>
						</div>
						<FileTree
							node={tree.root}
							expandedPaths={expandedTreePaths}
							selectedPath={props.selectedPath}
							onSelectPath={props.onSelectPath}
							onTogglePath={(path) => {
								setExpandedTreePaths((current) => {
									const next = new Set(current);
									if (next.has(path)) {
										next.delete(path);
									} else {
										next.add(path);
									}
									next.add("/");
									return next;
								});
							}}
						/>
					</section>
				</aside>

				<section className="focus-pane">
					<div className="intent-header">
						<p className="eyebrow">Tell donedone</p>
						<h2>What needs attention?</h2>
					</div>
					<ConversationView chat={chat} isWorking={progress.isWorking} />
					<Composer
						value={captureText}
						disabled={progress.isWorking}
						chatIsEmpty={chat.items.length === 0}
						automationMessage={automationMessage}
						hasApiKey={apiKey.trim().length > 0}
						onChange={setCaptureText}
						onSubmit={captureCommitment}
						onClearChat={() => void clearChat()}
					/>
				</section>

				<aside className="command-rail">
					{props.selectedPath ? (
						<FilePane
							path={props.selectedPath}
							title={selectedName}
							editor={editor}
							activeProjects={activeProjects}
							archivedProjects={archivedProjects}
							saving={sidebarSaving}
							onSelectPath={props.onSelectPath}
							onToggleTask={(lineIndex, checked) =>
								void toggleTaskLine(lineIndex, checked)
							}
							onUpdateLine={(lineIndex, content) =>
								void updateMarkdownLine(lineIndex, content)
							}
							onRename={(project) => void renameProject(project)}
							onArchive={(project) => void archiveProject(project)}
							onRestore={(project) => void restoreProject(project)}
							onDelete={(project) => void deleteProject(project)}
						/>
					) : null}
					<PlanningPanel
						disabled={progress.isWorking}
						onRun={(instruction) => void runPlaybook(instruction)}
					/>
				</aside>
			</main>

			{settingsOpen ? (
				<SettingsPanel
					apiKey={apiKey}
					model={model}
					onApiKeyChange={setApiKey}
					onModelChange={setModel}
					onClose={() => setSettingsOpen(false)}
					onNukeLocalState={props.onNukeLocalState}
				/>
			) : null}
			{addModalOpen ? (
				<AddItemModal
					activeProjectOptions={activeProjectOptions}
					newProjectName={newProjectName}
					newTaskText={newTaskText}
					taskTargetPath={taskTargetPath}
					message={sidebarMessage}
					saving={sidebarSaving}
					onClose={() => setAddModalOpen(false)}
					onNewProjectNameChange={setNewProjectName}
					onNewTaskTextChange={setNewTaskText}
					onTaskTargetPathChange={setTaskTargetPath}
					onCreateProject={createProject}
					onCreateTask={createTask}
				/>
			) : null}
		</div>
	);
}
