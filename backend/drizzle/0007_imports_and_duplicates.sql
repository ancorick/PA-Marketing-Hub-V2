CREATE TABLE "contact_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"actor_id" text NOT NULL,
	"rows_total" integer NOT NULL,
	"created" integer NOT NULL,
	"updated" integer NOT NULL,
	"invalid" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_dismissals" (
	"contact_a" uuid NOT NULL,
	"contact_b" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_dismissals_contact_a_contact_b_pk" PRIMARY KEY("contact_a","contact_b")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "email_key" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "import_id" uuid;--> statement-breakpoint
CREATE INDEX "contacts_email_key_idx" ON "contacts" USING btree ("email_key");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "contacts_import_idx" ON "contacts" USING btree ("import_id");--> statement-breakpoint
-- Backfill the duplicate key for existing contacts (same rule as emailKey() in src/contacts/fields.ts).
UPDATE "contacts" SET "email_key" = CASE
  WHEN split_part("email", '@', 2) IN ('gmail.com', 'googlemail.com')
    THEN replace(regexp_replace(split_part("email", '@', 1), '\+.*$', ''), '.', '') || '@gmail.com'
  ELSE regexp_replace(split_part("email", '@', 1), '\+.*$', '') || '@' || split_part("email", '@', 2)
END WHERE "email" IS NOT NULL;
