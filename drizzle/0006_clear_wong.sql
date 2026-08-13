CREATE TABLE "calendar_event_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"occurrence_starts_at" timestamp with time zone NOT NULL,
	"notify_at" timestamp with time zone NOT NULL,
	"provider_sequence_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"provider_scheduled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_notification_deliveries_valid_state" CHECK ("calendar_event_notification_deliveries"."state" in ('pending', 'scheduled', 'cancel_pending', 'cancelled', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD COLUMN "notification_enabled" boolean;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD COLUMN "notification_offset_minutes" integer;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD COLUMN "notification_message" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "notification_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "notification_offset_minutes" integer;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "notification_message" text;--> statement-breakpoint
ALTER TABLE "calendar_event_notification_deliveries" ADD CONSTRAINT "calendar_event_notification_deliveries_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_notification_deliveries_occurrence_idx" ON "calendar_event_notification_deliveries" USING btree ("event_id","occurrence_starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_notification_deliveries_sequence_idx" ON "calendar_event_notification_deliveries" USING btree ("provider_sequence_id");--> statement-breakpoint
CREATE INDEX "calendar_event_notification_deliveries_notify_at_idx" ON "calendar_event_notification_deliveries" USING btree ("notify_at");--> statement-breakpoint
CREATE INDEX "calendar_event_notification_deliveries_state_idx" ON "calendar_event_notification_deliveries" USING btree ("state");--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "calendar_event_exceptions_valid_notification" CHECK ("calendar_event_exceptions"."notification_enabled" is null or ("calendar_event_exceptions"."notification_enabled" and "calendar_event_exceptions"."notification_offset_minutes" between 0 and 10080) or (not "calendar_event_exceptions"."notification_enabled" and "calendar_event_exceptions"."notification_offset_minutes" is null));--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_valid_notification" CHECK (("calendar_events"."notification_enabled" and "calendar_events"."notification_offset_minutes" between 0 and 10080) or (not "calendar_events"."notification_enabled" and "calendar_events"."notification_offset_minutes" is null));