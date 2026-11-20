CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" text NOT NULL,
	"roles" text[] NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"dedupe_key" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esp_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"message_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_imports" ADD COLUMN "send_blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_imports" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "contact_imports" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "alerts_open_idx" ON "alerts" USING btree ("resolved_at","created_at");