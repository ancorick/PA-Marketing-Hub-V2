CREATE TABLE "staff_activity" (
	"user_id" text NOT NULL,
	"week" text NOT NULL,
	"role" text NOT NULL,
	"views" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_activity_user_id_week_pk" PRIMARY KEY("user_id","week")
);
