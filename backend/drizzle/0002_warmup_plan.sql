CREATE TABLE "domain_daily_sends" (
	"domain_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_daily_sends_domain_id_day_pk" PRIMARY KEY("domain_id","day")
);
--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "warmup_days" integer DEFAULT 21 NOT NULL;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "warmup_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "warmup_skipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_daily_sends" ADD CONSTRAINT "domain_daily_sends_domain_id_sending_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."sending_domains"("id") ON DELETE cascade ON UPDATE no action;