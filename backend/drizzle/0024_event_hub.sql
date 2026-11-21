CREATE TABLE "event_hub_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text,
	"event_external_id" text,
	"event_id" uuid,
	"contact_id" uuid,
	"status" text DEFAULT 'registered' NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_registrations_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "manual_costs" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_registrations_event_idx" ON "event_registrations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_registrations_external_event_idx" ON "event_registrations" USING btree ("event_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_contact_event" ON "event_registrations" USING btree ("event_id","contact_id");--> statement-breakpoint
ALTER TABLE "manual_costs" ADD CONSTRAINT "manual_costs_external_ref_unique" UNIQUE("external_ref");