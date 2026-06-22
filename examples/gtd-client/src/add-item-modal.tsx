import type { FormEvent } from "react";

export function AddItemModal(props: {
	readonly activeProjectOptions: readonly {
		readonly path: string;
		readonly name: string;
	}[];
	readonly newProjectName: string;
	readonly newTaskText: string;
	readonly taskTargetPath: string;
	readonly message: string;
	readonly saving: boolean;
	readonly onClose: () => void;
	readonly onNewProjectNameChange: (value: string) => void;
	readonly onNewTaskTextChange: (value: string) => void;
	readonly onTaskTargetPathChange: (value: string) => void;
	readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void;
	readonly onCreateTask: (event: FormEvent<HTMLFormElement>) => void;
}) {
	return (
		<div className="modal-backdrop">
			<section className="add-modal" aria-label="Add project or task">
				<div className="settings-header">
					<div>
						<p className="eyebrow">Add</p>
						<h2>New project or task</h2>
					</div>
					<button type="button" onClick={props.onClose}>
						Close
					</button>
				</div>
				<form className="modal-form" onSubmit={props.onCreateProject}>
					<label>
						<span>Project</span>
						<input
							aria-label="New project"
							value={props.newProjectName}
							placeholder="Launch Q3 review"
							onChange={(event) =>
								props.onNewProjectNameChange(event.currentTarget.value)
							}
						/>
					</label>
					<button
						type="submit"
						disabled={props.saving || props.newProjectName.trim().length === 0}
					>
						Add project
					</button>
				</form>
				<form className="modal-form" onSubmit={props.onCreateTask}>
					<label>
						<span>Task</span>
						<input
							aria-label="New task"
							value={props.newTaskText}
							placeholder="Draft agenda"
							onChange={(event) =>
								props.onNewTaskTextChange(event.currentTarget.value)
							}
						/>
					</label>
					<label>
						<span>List</span>
						<select
							aria-label="Task list"
							value={props.taskTargetPath}
							onChange={(event) =>
								props.onTaskTargetPathChange(event.currentTarget.value)
							}
						>
							<option value="/inbox.md">Inbox</option>
							{props.activeProjectOptions.map((project) => (
								<option key={project.path} value={project.path}>
									{project.name}
								</option>
							))}
						</select>
					</label>
					<button
						type="submit"
						disabled={props.saving || props.newTaskText.trim().length === 0}
					>
						Add task
					</button>
				</form>
				{props.message ? (
					<p className="sidebar-message">{props.message}</p>
				) : null}
			</section>
		</div>
	);
}
