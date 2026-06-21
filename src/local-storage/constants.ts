import type { ThetaStorageMigration } from "./types.ts";

export const THETA_LOCAL_STORAGE_STRATEGY = {
	controlPlane: "pglite",
	fileBytes: "opfs",
	durableSync: "postgres-electric",
} as const;

export const THETA_LOCAL_STORAGE_SCHEMA_VERSION = 1;

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
	];
