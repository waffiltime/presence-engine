CREATE TABLE `approval_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`surface_id` text NOT NULL,
	`manage_policy` text NOT NULL,
	`mechanism` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`preview` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`evidence_url` text,
	`created_at` text NOT NULL,
	`decided_at` text,
	`executed_at` text
);
--> statement-breakpoint
CREATE INDEX `aq_record_idx` ON `approval_queue` (`record_id`);--> statement-breakpoint
CREATE INDEX `aq_status_idx` ON `approval_queue` (`status`);