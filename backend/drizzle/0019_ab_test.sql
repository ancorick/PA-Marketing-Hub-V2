ALTER TABLE "deliveries" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "subject_b" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "ab_sample_percent" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "ab_wait_hours" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "subject_b" text;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "ab_sample_percent" integer;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "ab_wait_hours" integer;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "ab_decide_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "ab_winner" text;