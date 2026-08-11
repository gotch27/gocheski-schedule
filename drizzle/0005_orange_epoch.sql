CREATE TABLE "calendar_todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"estimated_minutes" integer,
	"scheduled_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_todos_valid_estimate" CHECK ("calendar_todos"."estimated_minutes" is null or "calendar_todos"."estimated_minutes" between 15 and 900),
	CONSTRAINT "calendar_todos_valid_sort_order" CHECK ("calendar_todos"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX "calendar_todos_scheduled_at_idx" ON "calendar_todos" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "calendar_todos_sort_order_idx" ON "calendar_todos" USING btree ("sort_order");