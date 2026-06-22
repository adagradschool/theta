import type { FormEvent } from "react";

import type { useThetaEditorFile } from "../../../src/react.ts";

import type { ProjectRecord } from "./app-model.ts";

import { CalendarView } from "./calendar-view.tsx";

import { MarkdownNote } from "./markdown-note.tsx";

import { ProjectListView } from "./project-list-view.tsx";

export function SystemNav(props: {
	readonly activeProjectCount: number;
	readonly onSelectPath: (path: string) => void;
	readonly onAdd: () => void;
}) {
	return (
		<nav className="system-nav" aria-label="GTD files">
			<button type="button" onClick={() => props.onSelectPath("/today.md")}>
				<span>Today</span>
				<strong>Plan</strong>
			</button>
			<button type="button" onClick={() => props.onSelectPath("/inbox.md")}>
				<span>Inbox</span>
				<strong>Capture</strong>
			</button>
			<div className="nav-row">
				<button
					type="button"
					onClick={() => props.onSelectPath("/projects.md")}
				>
					<span>Projects</span>
					<strong>{props.activeProjectCount}</strong>
				</button>
				<button
					type="button"
					className="icon-button"
					aria-label="Add project"
					onClick={props.onAdd}
				>
					+
				</button>
			</div>
			<button
				type="button"
				onClick={() => props.onSelectPath("/waiting-for.md")}
			>
				<span>Waiting</span>
				<strong>Open</strong>
			</button>
			<button type="button" onClick={() => props.onSelectPath("/calendar.md")}>
				<span>Calendar</span>
				<strong>Local</strong>
			</button>
		</nav>
	);
}

export function Composer(props: {
	readonly value: string;
	readonly disabled: boolean;
	readonly chatIsEmpty: boolean;
	readonly automationMessage: string;
	readonly hasApiKey: boolean;
	readonly onChange: (value: string) => void;
	readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	readonly onClearChat: () => void;
}) {
	return (
		<form className="intent-form" onSubmit={props.onSubmit}>
			<textarea
				aria-label="New input"
				value={props.value}
				placeholder="Add a task, ask a question, or tell donedone what changed."
				onChange={(event) => props.onChange(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (
						event.key === "Enter" &&
						!event.shiftKey &&
						!event.metaKey &&
						!event.ctrlKey
					) {
						event.preventDefault();
						event.currentTarget.form?.requestSubmit();
					}
				}}
			/>
			<div className="composer-footer">
				{props.automationMessage ? (
					<p className="automation-message">{props.automationMessage}</p>
				) : !props.hasApiKey ? (
					<p className="status">
						Connect donedone in Settings for automatic sorting.
					</p>
				) : (
					<span />
				)}
				<div className="composer-actions">
					<button
						type="button"
						className="secondary-action"
						aria-label="Clear chat"
						title="Clear chat"
						disabled={props.disabled || props.chatIsEmpty}
						onClick={props.onClearChat}
					>
						Clear Chat
					</button>
					<button
						type="submit"
						disabled={props.value.trim().length === 0 || props.disabled}
					>
						Send
					</button>
				</div>
			</div>
		</form>
	);
}

export function FilePane(props: {
	readonly path: string;
	readonly title: string;
	readonly editor: ReturnType<typeof useThetaEditorFile>;
	readonly activeProjects: readonly ProjectRecord[];
	readonly archivedProjects: readonly ProjectRecord[];
	readonly saving: boolean;
	readonly onSelectPath: (path: string | undefined) => void;
	readonly onToggleTask: (lineIndex: number, checked: boolean) => void;
	readonly onUpdateLine: (lineIndex: number, content: string) => void;
	readonly onRename: (project: ProjectRecord) => void;
	readonly onArchive: (project: ProjectRecord) => void;
	readonly onRestore: (project: ProjectRecord) => void;
	readonly onDelete: (project: ProjectRecord) => void;
}) {
	return (
		<section className="file-viewer">
			<div className="focus-header">
				<div>
					<p className="eyebrow">File</p>
					<h2>{props.title}</h2>
				</div>
				<div className="toolbar">
					<span>
						{props.editor.binding?.dirty ? "Unsaved changes" : "Saved"}
					</span>
					<button
						type="button"
						disabled={!props.editor.binding || props.editor.isSaving}
						onClick={() => void props.editor.save()}
					>
						Save
					</button>
					<button
						type="button"
						className="file-close-button"
						aria-label="Hide file pane"
						title="Hide file pane"
						onClick={() => props.onSelectPath(undefined)}
					>
						X
					</button>
				</div>
			</div>
			<div className="editor-frame">
				{props.path === "/calendar.md" ? (
					<CalendarView text={props.editor.text} />
				) : props.path === "/projects.md" ? (
					<ProjectListView
						activeProjects={props.activeProjects}
						archivedProjects={props.archivedProjects}
						saving={props.saving}
						onOpen={(project) => props.onSelectPath(project.tasksPath)}
						onRename={props.onRename}
						onArchive={props.onArchive}
						onRestore={props.onRestore}
						onDelete={props.onDelete}
					/>
				) : (
					<MarkdownNote
						text={props.editor.text}
						onToggleTask={props.onToggleTask}
						onUpdateLine={props.onUpdateLine}
					/>
				)}
			</div>
			{props.editor.error ? (
				<p className="status bad">{props.editor.error.message}</p>
			) : null}
		</section>
	);
}

export function PlanningPanel(props: {
	readonly disabled: boolean;
	readonly onRun: (instruction: string) => void;
}) {
	return (
		<section className="planning-panel">
			<div className="section-heading">
				<h2>Planning</h2>
			</div>
			<div className="playbook-list">
				{playbooks.map((playbook) => (
					<button
						type="button"
						className="playbook-card"
						key={playbook.label}
						disabled={props.disabled}
						onClick={() => props.onRun(playbook.instruction)}
					>
						<strong>{playbook.label}</strong>
						<span>{playbook.description}</span>
					</button>
				))}
			</div>
		</section>
	);
}

const playbooks = [
	{
		label: "Process inbox",
		description: "Talk through loose captures and place the obvious ones.",
		instruction: [
			"Let's process the inbox together.",
			"First quietly read projects.md, the active project info/tasks/done files, today.md, waiting-for.md, someday-maybe.md, calendar.md, and reference/contexts.md.",
			"For each inbox item, use judgment. If it is already a clear next action with an obvious project and context, move it to the right file and briefly tell me what you did.",
			"If it has a specific date or time, put it in calendar.md. Do not ask whether a clear time-specific commitment belongs on the calendar.",
			"If it is fuzzy, ask the smallest useful question instead of writing clarification notes into files.",
			"Work/admin follow-ups such as visa, payroll, company, client, team, deadline, or ProphecyGov belong in Work. Personal relationship follow-ups belong in Social.",
			"Never create /tasks. Use project tasks.md, project done.md, today.md, calendar.md, waiting-for.md, someday-maybe.md, or inbox.md.",
			"Keep the reply conversational: short, specific, and oriented around what needs my attention next.",
		].join("\n"),
	},
	{
		label: "Plan today",
		description: "Shape a realistic day from open loops.",
		instruction: [
			"Plan today now.",
			"Read /AGENTS.md, today.md, inbox.md, projects.md, all active project info/tasks/done files, waiting-for.md, someday-maybe.md, calendar.md, and reference/contexts.md.",
			"Do not ask what to focus on before making the plan. Use the available information and make reasonable judgment calls.",
			"Update /today.md with a concrete realistic draft: must-do items, dated/time-specific commitments, work, social, errands, physical, waiting, and notes.",
			"Pull in obvious pending tasks from active project task files and waiting-for.md. Keep the list small enough to be usable today.",
			"If an inbox item is too vague, leave it in inbox.md and mention it under Notes or in the reply as an unresolved item. Do not block the plan on it.",
			"Reply with the plan you wrote and the few assumptions you made. Ask at most one follow-up question, and only after the draft exists.",
		].join("\n"),
	},
	{
		label: "Weekly review",
		description: "Reflect, clean up, and choose next week.",
		instruction:
			"Walk me through a weekly review. Read the active projects, waiting-for, someday-maybe, calendar, today.md, and inbox. Start conversationally with what looks healthy, what looks stale, and the few questions you need answered before making changes.",
	},
] as const;
