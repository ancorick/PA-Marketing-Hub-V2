CREATE TABLE "segment_members" (
	"segment_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segment_members_segment_id_contact_id_pk" PRIMARY KEY("segment_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"rule" jsonb,
	"owner_id" text NOT NULL,
	"last_count" integer,
	"last_counted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segment_members_contact_idx" ON "segment_members" USING btree ("contact_id");