CREATE TABLE "dmarc_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"source_ip" text NOT NULL,
	"count" integer NOT NULL,
	"disposition" text,
	"dkim" text,
	"spf" text,
	"header_from" text,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmarc_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_name" text NOT NULL,
	"report_id" text NOT NULL,
	"domain" text NOT NULL,
	"policy" text,
	"date_begin" timestamp with time zone NOT NULL,
	"date_end" timestamp with time zone NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dmarc_records" ADD CONSTRAINT "dmarc_records_report_id_dmarc_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."dmarc_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dmarc_records_report_idx" ON "dmarc_records" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "dmarc_records_ip_idx" ON "dmarc_records" USING btree ("source_ip");--> statement-breakpoint
CREATE UNIQUE INDEX "dmarc_reports_org_report_idx" ON "dmarc_reports" USING btree ("org_name","report_id");