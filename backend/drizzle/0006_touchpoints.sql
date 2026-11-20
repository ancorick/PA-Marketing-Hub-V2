CREATE TABLE "touchpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"channel" text,
	"campaign" text,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_system" text NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "touchpoints_contact_idx" ON "touchpoints" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "touchpoints_occurred_idx" ON "touchpoints" USING btree ("occurred_at");