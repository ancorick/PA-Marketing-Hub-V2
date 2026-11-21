CREATE TABLE "manual_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"campaign" text,
	"description" text NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"amount_amd" integer NOT NULL,
	"original_amount" text NOT NULL,
	"currency" text NOT NULL,
	"rate_to_amd" text NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "manual_costs_dates_idx" ON "manual_costs" USING btree ("date_from","date_to");