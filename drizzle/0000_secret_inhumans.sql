CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"color" text DEFAULT 'violet' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_valid_range" CHECK ("calendar_events"."ends_at" > "calendar_events"."starts_at"),
	CONSTRAINT "calendar_events_valid_color" CHECK ("calendar_events"."color" in ('violet', 'blue', 'coral', 'green', 'amber'))
);
--> statement-breakpoint
CREATE INDEX "calendar_events_starts_at_idx" ON "calendar_events" USING btree ("starts_at");