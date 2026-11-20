CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"state" text NOT NULL,
	"method" text NOT NULL,
	"wording_version" text,
	"source_url" text,
	"ip" text,
	"actor_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"lifted_at" timestamp with time zone,
	"lift_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_contact_idx" ON "consent_records" USING btree ("contact_id","topic","created_at");--> statement-breakpoint
CREATE INDEX "suppressions_email_hash_idx" ON "suppressions" USING btree ("email_hash");