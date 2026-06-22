import type { useThetaFileTree } from "../../../src/react.ts";
import { formatWorkspaceName } from "./workspace-runtime.ts";

type FileTreeRoot = ReturnType<typeof useThetaFileTree>["root"];
type FileTreeNode = FileTreeRoot["children"][number];

export function FileTree(props: {
	readonly node: FileTreeRoot;
	readonly expandedPaths: ReadonlySet<string>;
	readonly selectedPath: string | undefined;
	readonly onSelectPath: (path: string) => void;
	readonly onTogglePath: (path: string) => void;
}) {
	return (
		<ul className={props.node.path === "/" ? "tree root" : "tree"}>
			{props.node.children.map((child) => (
				<TreeNode
					key={child.path}
					node={child}
					expandedPaths={props.expandedPaths}
					selectedPath={props.selectedPath}
					onSelectPath={props.onSelectPath}
					onTogglePath={props.onTogglePath}
				/>
			))}
		</ul>
	);
}

function TreeNode(props: {
	readonly node: FileTreeNode;
	readonly expandedPaths: ReadonlySet<string>;
	readonly selectedPath: string | undefined;
	readonly onSelectPath: (path: string) => void;
	readonly onTogglePath: (path: string) => void;
}) {
	const isDirectory = props.node.kind === "directory";
	const isExpanded = props.expandedPaths.has(props.node.path);
	const hasChildren = props.node.children.length > 0;
	return (
		<li>
			<button
				type="button"
				aria-expanded={isDirectory ? isExpanded : undefined}
				className={props.node.path === props.selectedPath ? "selected" : ""}
				onClick={() => {
					if (isDirectory) {
						props.onTogglePath(props.node.path);
					} else {
						props.onSelectPath(props.node.path);
					}
				}}
			>
				<span className={`node-kind ${props.node.kind}`} />
				<span className="tree-label">
					{formatWorkspaceName(props.node.name)}
				</span>
				{isDirectory ? (
					<span
						className={`tree-caret ${isExpanded ? "expanded" : ""}`}
						aria-hidden="true"
					/>
				) : null}
			</button>
			{isDirectory && isExpanded && hasChildren ? (
				<FileTree
					node={props.node}
					expandedPaths={props.expandedPaths}
					selectedPath={props.selectedPath}
					onSelectPath={props.onSelectPath}
					onTogglePath={props.onTogglePath}
				/>
			) : null}
		</li>
	);
}
