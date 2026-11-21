CREATE TABLE "channel_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"channel" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unmapped_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"resolved_channel_id" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "touchpoints" ADD COLUMN "utm_source" text;--> statement-breakpoint
ALTER TABLE "touchpoints" ADD COLUMN "utm_medium" text;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_rules_key" ON "channel_rules" USING btree ("kind","value");--> statement-breakpoint
CREATE UNIQUE INDEX "unmapped_values_key" ON "unmapped_values" USING btree ("source","field","value");