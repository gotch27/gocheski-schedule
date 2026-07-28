CREATE TABLE "calendar_event_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"occurrence_starts_at" timestamp with time zone NOT NULL,
	"title" text,
	"description" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"color" text,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_exceptions_valid_range" CHECK ("calendar_event_exceptions"."is_cancelled" or ("calendar_event_exceptions"."starts_at" is not null and "calendar_event_exceptions"."ends_at" > "calendar_event_exceptions"."starts_at")),
	CONSTRAINT "calendar_event_exceptions_valid_color" CHECK ("calendar_event_exceptions"."color" is null or "calendar_event_exceptions"."color" in ('violet', 'blue', 'coral', 'green', 'amber'))
);
--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "calendar_event_exceptions_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_exceptions_occurrence_idx" ON "calendar_event_exceptions" USING btree ("event_id","occurrence_starts_at");--> statement-breakpoint
CREATE INDEX "calendar_event_exceptions_starts_at_idx" ON "calendar_event_exceptions" USING btree ("starts_at");