CREATE TABLE "tracked_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"destination_url" text NOT NULL,
	"full_url" text NOT NULL,
	"channel" text NOT NULL,
	"utm_source" text NOT NULL,
	"utm_medium" text NOT NULL,
	"utm_campaign" text NOT NULL,
	"utm_content" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"last_click_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_links_code" ON "tracked_links" USING btree ("code");--> statement-breakpoint
CREATE INDEX "tracked_links_campaign_idx" ON "tracked_links" USING btree ("utm_campaign");