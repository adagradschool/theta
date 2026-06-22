import type { ProjectRecord } from "./app-model.ts";

export function ProjectListView(props: {
	readonly activeProjects: readonly ProjectRecord[];
	readonly archivedProjects: readonly ProjectRecord[];
	readonly saving: boolean;
	readonly onOpen: (project: ProjectRecord) => void;
	readonly onRename: (project: ProjectRecord) => void;
	readonly onArchive: (project: ProjectRecord) => void;
	readonly onRestore: (project: ProjectRecord) => void;
	readonly onDelete: (project: ProjectRecord) => void;
}) {
	return (
		<div className="project-list-view" data-testid="project-list-view">
			<ProjectListSection
				title="Active"
				empty="No active projects."
				projects={props.activeProjects}
				saving={props.saving}
				onOpen={props.onOpen}
				onRename={props.onRename}
				onArchive={props.onArchive}
				onRestore={props.onRestore}
				onDelete={props.onDelete}
			/>
			<ProjectListSection
				title="Archived"
				empty="No archived projects."
				projects={props.archivedProjects}
				saving={props.saving}
				onOpen={props.onOpen}
				onRename={props.onRename}
				onArchive={props.onArchive}
				onRestore={props.onRestore}
				onDelete={props.onDelete}
			/>
		</div>
	);
}

function ProjectListSection(props: {
	readonly title: string;
	readonly empty: string;
	readonly projects: readonly ProjectRecord[];
	readonly saving: boolean;
	readonly onOpen: (project: ProjectRecord) => void;
	readonly onRename: (project: ProjectRecord) => void;
	readonly onArchive: (project: ProjectRecord) => void;
	readonly onRestore: (project: ProjectRecord) => void;
	readonly onDelete: (project: ProjectRecord) => void;
}) {
	return (
		<section className="project-list-section">
			<div className="calendar-header">
				<h3>{props.title}</h3>
				<span>{props.projects.length}</span>
			</div>
			{props.projects.length === 0 ? (
				<p className="calendar-empty">{props.empty}</p>
			) : (
				<div className="project-rows">
					{props.projects.map((project) => (
						<article className="project-row" key={project.path}>
							<div>
								<strong>{project.name}</strong>
								<span>{project.slug}</span>
							</div>
							<div className="project-actions">
								<button type="button" onClick={() => props.onOpen(project)}>
									Open
								</button>
								<button
									type="button"
									disabled={props.saving}
									onClick={() => props.onRename(project)}
								>
									Rename
								</button>
								{project.status === "active" ? (
									<button
										type="button"
										disabled={props.saving}
										onClick={() => props.onArchive(project)}
									>
										Archive
									</button>
								) : (
									<button
										type="button"
										disabled={props.saving}
										onClick={() => props.onRestore(project)}
									>
										Restore
									</button>
								)}
								<button
									type="button"
									disabled={props.saving}
									onClick={() => props.onDelete(project)}
								>
									Delete
								</button>
							</div>
						</article>
					))}
				</div>
			)}
		</section>
	);
}
