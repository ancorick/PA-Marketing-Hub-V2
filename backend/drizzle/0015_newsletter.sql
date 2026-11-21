CREATE TABLE "collected_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" text NOT NULL,
	"source_ref" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"publishable" boolean NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"language" text,
	"starts_at" timestamp with time zone NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"registration_url" text,
	"registration_open" boolean DEFAULT false NOT NULL,
	"recording_url" text,
	"photos_url" text,
	"media_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "issue_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"type" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"item_ids" uuid[] NOT NULL,
	"image_url" text,
	"image_alt" text,
	"button_label" text,
	"button_url" text,
	"ai_drafted" boolean DEFAULT false NOT NULL,
	"edited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cadence_id" uuid NOT NULL,
	"edition" text NOT NULL,
	"language" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"cut_off_at" timestamp with time zone,
	"collect_at" timestamp with time zone NOT NULL,
	"planned_send_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'collecting' NOT NULL,
	"subject" text,
	"preheader" text,
	"subject_ai_drafted" boolean DEFAULT false NOT NULL,
	"send_id" uuid,
	"archive_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_archive_slug_unique" UNIQUE("archive_slug")
);
--> statement-breakpoint
CREATE TABLE "newsletter_cadences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"interval" text DEFAULT 'monthly' NOT NULL,
	"send_day" integer DEFAULT 10 NOT NULL,
	"send_hour" integer DEFAULT 11 NOT NULL,
	"collect_working_days" integer DEFAULT 5 NOT NULL,
	"languages" text[] NOT NULL,
	"segments" jsonb NOT NULL,
	"template_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_blocks" ADD CONSTRAINT "issue_blocks_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_cadence_id_newsletter_cadences_id_fk" FOREIGN KEY ("cadence_id") REFERENCES "public"."newsletter_cadences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collected_items_source_idx" ON "collected_items" USING btree ("source_system","source_ref","type");--> statement-breakpoint
CREATE INDEX "events_starts_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "issue_blocks_issue_idx" ON "issue_blocks" USING btree ("issue_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_edition_idx" ON "issues" USING btree ("cadence_id","edition","language");