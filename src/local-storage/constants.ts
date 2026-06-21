import type { ThetaStorageMigration } from "./types.ts";

export const THETA_LOCAL_STORAGE_STRATEGY = {
	controlPlane: "pglite",
	fileBytes: "opfs",
	durableSync: "postgres-electric",
} as const;

export const THETA_LOCAL_STORAGE_SCHEMA_VERSION = 5;

export const THETA_LOCAL_STORAGE_MIGRATIONS: readonly ThetaStorageMigration[] =
	[
		{
			version: 1,
			description:
				"Create workspace entry and content-addressed file version metadata.",
			sql: [
				`create table if not exists theta_schema_migrations (
  version integer primary key,
  description text not null,
  applied_at bigint not null
)`,
				`create table if not exists theta_workspace_entries (
  workspace_id text not null,
  path text not null,
  parent_path text not null,
  name text not null,
  kind text not null check (kind in ('file', 'directory')),
  version text not null,
  size bigint not null,
  content_hash text,
  mime_type text,
  metadata_json text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  primary key (workspace_id, path)
)`,
				`create index if not exists theta_workspace_entries_parent_idx
on theta_workspace_entries (workspace_id, parent_path, name)`,
				`create table if not exists theta_file_versions (
  workspace_id text not null,
  path text not null,
  version text not null,
  content_hash text not null,
  size bigint not null,
  created_at bigint not null,
  primary key (workspace_id, path, version)
)`,
			],
		},
		{
			version: 2,
			description:
				"Create durable session, branch, and session entry metadata.",
			sql: [
				`create table if not exists theta_sessions (
  id text primary key,
  workspace_id text,
  title text not null,
  root_branch_id text not null,
  active_branch_id text not null,
  metadata_json text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
)`,
				`create index if not exists theta_sessions_workspace_idx
on theta_sessions (workspace_id, updated_at)`,
				`create table if not exists theta_session_branches (
  id text primary key,
  session_id text not null,
  parent_branch_id text,
  parent_entry_id text,
  title text,
  metadata_json text,
  created_at bigint not null,
  updated_at bigint not null
)`,
				`create index if not exists theta_session_branches_session_idx
on theta_session_branches (session_id, created_at)`,
				`create table if not exists theta_session_entries (
  id text primary key,
  session_id text not null,
  branch_id text not null,
  parent_entry_id text,
  kind text not null check (kind in ('message', 'modelChange', 'thinkingLevelChange', 'custom')),
  payload_json text not null,
  metadata_json text,
  created_at bigint not null
)`,
				`create index if not exists theta_session_entries_session_idx
on theta_session_entries (session_id, created_at)`,
				`create index if not exists theta_session_entries_branch_idx
on theta_session_entries (session_id, branch_id, created_at)`,
			],
		},
		{
			version: 3,
			description: "Allow durable session compaction entries.",
			sql: [
				`alter table theta_session_entries
drop constraint if exists theta_session_entries_kind_check`,
				`alter table theta_session_entries
add constraint theta_session_entries_kind_check
check (kind in ('message', 'modelChange', 'thinkingLevelChange', 'compaction', 'custom'))`,
			],
		},
		{
			version: 4,
			description:
				"Add local-first blob sync and device metadata to workspace manifests.",
			sql: [
				`alter table theta_workspace_entries
add column if not exists blob_sync_status text`,
				`alter table theta_workspace_entries
add column if not exists created_by_device_id text`,
				`alter table theta_workspace_entries
add column if not exists updated_by_device_id text`,
				`alter table theta_file_versions
add column if not exists created_by_device_id text`,
				`create index if not exists theta_workspace_entries_blob_status_idx
on theta_workspace_entries (workspace_id, blob_sync_status)`,
			],
		},
		{
			version: 5,
			description: "Create durable workspace mutation queue.",
			sql: [
				`create table if not exists theta_workspace_mutation_queue (
  id text primary key,
  workspace_id text not null,
  kind text not null check (kind in ('putEntry', 'recordFileVersion', 'deleteEntry')),
  payload_json text not null,
  attempts integer not null default 0,
  last_error text,
  created_at bigint not null,
  updated_at bigint not null
)`,
				`create index if not exists theta_workspace_mutation_queue_workspace_idx
on theta_workspace_mutation_queue (workspace_id, created_at)`,
			],
		},
	];
