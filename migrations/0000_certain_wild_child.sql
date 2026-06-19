CREATE TABLE `audit_runs` (
	`audit_id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`coverage_score` real NOT NULL,
	`report` text NOT NULL,
	`presence` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ar_record_idx` ON `audit_runs` (`record_id`);--> statement-breakpoint
CREATE TABLE `canonical_records` (
	`record_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`lifecycle_status` text NOT NULL,
	`system_status` text DEFAULT 'draft' NOT NULL,
	`schema_version` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cr_kind_idx` ON `canonical_records` (`kind`);--> statement-breakpoint
CREATE INDEX `cr_slug_idx` ON `canonical_records` (`slug`);--> statement-breakpoint
CREATE TABLE `mentions` (
	`mention_id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`surface` text NOT NULL,
	`surface_id` text,
	`url` text,
	`excerpt` text,
	`found_at` text NOT NULL,
	`classification` text,
	`sentiment` real,
	`reach_score` real,
	`velocity_flag` integer DEFAULT false,
	`linked_claim_id` text,
	`status` text DEFAULT 'new' NOT NULL,
	`raw` text
);
--> statement-breakpoint
CREATE INDEX `m_record_idx` ON `mentions` (`record_id`);--> statement-breakpoint
CREATE INDEX `m_status_idx` ON `mentions` (`status`);--> statement-breakpoint
CREATE TABLE `opportunities` (
	`opportunity_id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`type` text NOT NULL,
	`url` text,
	`summary` text,
	`detected_at` text NOT NULL,
	`draft` text,
	`draft_status` text DEFAULT 'none' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`raw` text
);
--> statement-breakpoint
CREATE INDEX `o_record_idx` ON `opportunities` (`record_id`);--> statement-breakpoint
CREATE TABLE `provenance_log` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text,
	`event_type` text NOT NULL,
	`actor` text NOT NULL,
	`target` text,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pl_record_idx` ON `provenance_log` (`record_id`);--> statement-breakpoint
CREATE INDEX `pl_type_idx` ON `provenance_log` (`event_type`);--> statement-breakpoint
CREATE TABLE `record_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rv_record_idx` ON `record_versions` (`record_id`);--> statement-breakpoint
CREATE TABLE `surfaces` (
	`surface_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`surface_type` text NOT NULL,
	`relevant_kinds` text NOT NULL,
	`monitor` text NOT NULL,
	`manage_policy` text NOT NULL,
	`manage_mechanism` text,
	`feed_driven` integer DEFAULT false NOT NULL,
	`notes` text,
	`build_priority` text
);
