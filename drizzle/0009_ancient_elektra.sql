CREATE TABLE "calendar_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"time_zone" text NOT NULL,
	"color" text DEFAULT 'violet' NOT NULL,
	"achieved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_goals_valid_range" CHECK ("calendar_goals"."ends_on" >= "calendar_goals"."starts_on"),
	CONSTRAINT "calendar_goals_valid_color" CHECK ("calendar_goals"."color" in ('violet', 'blue', 'coral', 'green', 'amber'))
);
--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD COLUMN "goal_is_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_todos" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "calendar_event_exceptions_goal_id_calendar_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."calendar_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_goal_id_calendar_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."calendar_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_todos" ADD CONSTRAINT "calendar_todos_goal_id_calendar_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."calendar_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_exceptions_goal_id_idx" ON "calendar_event_exceptions" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "calendar_events_goal_id_idx" ON "calendar_events" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "calendar_todos_goal_id_idx" ON "calendar_todos" USING btree ("goal_id");