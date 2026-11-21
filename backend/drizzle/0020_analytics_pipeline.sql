CREATE TABLE "ad_spend_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"platform" text NOT NULL,
	"platform_campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"campaign" text NOT NULL,
	"channel" text NOT NULL,
	"amount_amd" integer NOT NULL,
	"original_amount" text NOT NULL,
	"currency" text NOT NULL,
	"rate_to_amd" text NOT NULL,
	"impressions" integer NOT NULL,
	"clicks" integer NOT NULL,
	"leads" integer NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"endpoint" text NOT NULL,
	"window_from" date NOT NULL,
	"window_to" date NOT NULL,
	"payload" jsonb NOT NULL,
	"pulled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"reach" integer NOT NULL,
	"engagement" integer NOT NULL,
	"followers" integer NOT NULL,
	"lead_forms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_traffic_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"utm_source" text DEFAULT '' NOT NULL,
	"utm_medium" text DEFAULT '' NOT NULL,
	"utm_campaign" text DEFAULT '' NOT NULL,
	"landing_page" text NOT NULL,
	"channel" text,
	"sessions" integer NOT NULL,
	"conversions" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ad_spend_daily_key" ON "ad_spend_daily" USING btree ("platform","platform_campaign_id","date");--> statement-breakpoint
CREATE INDEX "ad_spend_daily_channel_idx" ON "ad_spend_daily" USING btree ("channel","date");--> statement-breakpoint
CREATE INDEX "raw_records_source_idx" ON "raw_records" USING btree ("source","window_from");--> statement-breakpoint
CREATE INDEX "raw_records_pulled_idx" ON "raw_records" USING btree ("pulled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_daily_key" ON "social_daily" USING btree ("platform","account_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "web_traffic_daily_key" ON "web_traffic_daily" USING btree ("date","utm_source","utm_medium","utm_campaign","landing_page");--> statement-breakpoint
CREATE INDEX "web_traffic_daily_channel_idx" ON "web_traffic_daily" USING btree ("channel","date");