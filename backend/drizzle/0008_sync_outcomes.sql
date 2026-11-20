CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"core_person_id" text,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"course_id" text,
	"group_id" text,
	"source_system" text NOT NULL,
	"source_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"rows_in" integer DEFAULT 0 NOT NULL,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"error" text,
	"window_from" timestamp with time zone,
	"window_to" timestamp with time zone,
	"triggered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "crm_lead_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "crm_stage" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "self_reported_source" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "employment_status" text;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_source_idx" ON "outcomes" USING btree ("source_system","source_ref","type");--> statement-breakpoint
CREATE INDEX "outcomes_contact_idx" ON "outcomes" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sync_runs_source_idx" ON "sync_runs" USING btree ("source","started_at");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_crm_lead_id_unique" UNIQUE("crm_lead_id");