CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_id" uuid NOT NULL,
	"contact_id" uuid,
	"email" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"esp_message_id" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"first_click_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'campaign' NOT NULL,
	"topic" text NOT NULL,
	"purpose" text DEFAULT 'other' NOT NULL,
	"include_active_admissions" boolean DEFAULT false NOT NULL,
	"segment_id" uuid,
	"language" text NOT NULL,
	"from_name" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"preheader" text,
	"body" text NOT NULL,
	"button_label" text,
	"button_url" text,
	"utm_campaign" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"paused_reason" text,
	"scheduled_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_send_id_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."sends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_send_contact_idx" ON "deliveries" USING btree ("send_id","contact_id");--> statement-breakpoint
CREATE INDEX "deliveries_status_idx" ON "deliveries" USING btree ("send_id","status");--> statement-breakpoint
CREATE INDEX "deliveries_esp_idx" ON "deliveries" USING btree ("esp_message_id");--> statement-breakpoint
CREATE INDEX "deliveries_contact_idx" ON "deliveries" USING btree ("contact_id","sent_at");--> statement-breakpoint
CREATE INDEX "sends_status_idx" ON "sends" USING btree ("status","scheduled_at");