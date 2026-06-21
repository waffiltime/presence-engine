CREATE TABLE `connection_status` (
	`record_id` text NOT NULL,
	`surface_id` text NOT NULL,
	`state` text NOT NULL,
	`last_verified_at` text NOT NULL,
	PRIMARY KEY(`record_id`, `surface_id`)
);
