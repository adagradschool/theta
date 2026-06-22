export function MarkdownNote(props: {
	readonly text: string;
	readonly onToggleTask: (lineIndex: number, checked: boolean) => void;
	readonly onUpdateLine: (lineIndex: number, content: string) => void;
}) {
	const lines = props.text.split("\n");
	return (
		<div className="note-view" data-testid="note-view">
			{lines.map((line, lineIndex) => {
				const key = markdownLineKey(line, lineIndex);
				const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
				if (heading) {
					const level = heading[1]?.length ?? 1;
					return (
						<EditableLine
							className={`note-heading level-${level}`}
							key={key}
							value={heading[2] ?? ""}
							onCommit={(content) => props.onUpdateLine(lineIndex, content)}
						/>
					);
				}
				const task = /^(\s*)- \[([ xX])\]\s+(.+)$/u.exec(line);
				if (task) {
					const checked = task[2]?.toLowerCase() === "x";
					return (
						<label className="note-task" key={key}>
							<input
								type="checkbox"
								checked={checked}
								onChange={(event) =>
									props.onToggleTask(lineIndex, event.currentTarget.checked)
								}
							/>
							<EditableLine
								className="note-task-text"
								value={task[3] ?? ""}
								onCommit={(content) => props.onUpdateLine(lineIndex, content)}
							/>
						</label>
					);
				}
				const bullet = /^-\s+(.+)$/u.exec(line);
				if (bullet) {
					return (
						<div className="note-bullet" key={key}>
							<span />
							<EditableLine
								className="note-bullet-text"
								value={bullet[1] ?? ""}
								onCommit={(content) => props.onUpdateLine(lineIndex, content)}
							/>
						</div>
					);
				}
				if (line.trim().length === 0) {
					return <div className="note-space" key={key} />;
				}
				return (
					<EditableLine
						className="note-paragraph"
						key={key}
						value={line}
						onCommit={(content) => props.onUpdateLine(lineIndex, content)}
					/>
				);
			})}
		</div>
	);
}

function EditableLine(props: {
	readonly className: string;
	readonly value: string;
	readonly onCommit: (content: string) => void;
}) {
	return (
		<input
			className={`editable-line ${props.className}`}
			defaultValue={props.value}
			spellCheck
			onBlur={(event) => {
				const content = event.currentTarget.value.replace(/\n/gu, " ").trim();
				if (content !== props.value) {
					props.onCommit(content);
				}
			}}
		/>
	);
}

function markdownLineKey(line: string, lineIndex: number): string {
	return `${lineIndex}:${line}`;
}

export function replaceMarkdownLineContent(
	line: string,
	content: string,
): string {
	const nextContent = content.trim();
	const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
	if (heading) {
		return `${heading[1]} ${nextContent}`;
	}
	const task = /^(\s*)- \[([ xX])\]\s+(.+)$/u.exec(line);
	if (task) {
		return `${task[1]}- [${task[2]}] ${nextContent}`;
	}
	const bullet = /^(\s*)-\s+(.+)$/u.exec(line);
	if (bullet) {
		return `${bullet[1]}- ${nextContent}`;
	}
	return nextContent;
}
