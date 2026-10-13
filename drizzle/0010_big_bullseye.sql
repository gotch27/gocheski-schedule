CREATE TABLE "calendar_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_labels_valid_name" CHECK (length(trim("calendar_labels"."name")) between 1 and 60),
	CONSTRAINT "calendar_labels_valid_color" CHECK ("calendar_labels"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" DROP CONSTRAINT "calendar_event_exceptions_valid_color";--> statement-breakpoint
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_valid_color";--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD COLUMN "label_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD COLUMN "label_is_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "label_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "calendar_event_exceptions_label_id_calendar_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."calendar_labels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_label_id_calendar_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."calendar_labels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "calendar_event_exceptions_valid_color" CHECK ("calendar_event_exceptions"."color" is null or "calendar_event_exceptions"."color" in ('violet', 'blue', 'coral', 'green', 'amber') or "calendar_event_exceptions"."color" ~ '^#[0-9a-fA-F]{6}$');--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_valid_color" CHECK ("calendar_events"."color" in ('violet', 'blue', 'coral', 'green', 'amber') or "calendar_events"."color" ~ '^#[0-9a-fA-F]{6}$');
--> statement-breakpoint
-- Turn the existing palette into editable starter labels without changing event colors.
INSERT INTO "calendar_labels" ("id", "name", "color") VALUES
  ('e10a0000-0000-4000-8000-000000000001', 'Violet', '#8c6cff'),
  ('e10a0000-0000-4000-8000-000000000002', 'Blue', '#5aace0'),
  ('e10a0000-0000-4000-8000-000000000003', 'Coral', '#e98175'),
  ('e10a0000-0000-4000-8000-000000000004', 'Green', '#54ae8c'),
  ('e10a0000-0000-4000-8000-000000000005', 'Amber', '#dfa93a');
--> statement-breakpoint
UPDATE "calendar_events" AS event SET "label_id" = label."id", "color" = label."color"
FROM "calendar_labels" AS label WHERE lower(label."name") = event."color";
--> statement-breakpoint
UPDATE "calendar_event_exceptions" AS exception
SET "label_id" = label."id", "label_is_overridden" = true, "color" = label."color"
FROM "calendar_labels" AS label
WHERE lower(label."name") = exception."color";
