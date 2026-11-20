CREATE TABLE "sending_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"esp_identity" jsonb NOT NULL,
	"spf_status" text DEFAULT 'pending' NOT NULL,
	"dkim_status" text DEFAULT 'pending' NOT NULL,
	"dmarc_status" text DEFAULT 'pending' NOT NULL,
	"tracking_status" text DEFAULT 'pending' NOT NULL,
	"dmarc_policy" text,
	"last_check" jsonb,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"warmup_stage" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sending_domains_domain_unique" UNIQUE("domain")
);
