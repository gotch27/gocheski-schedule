CREATE TABLE "calendar_to_buy_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_to_buy_items_valid_sort_order" CHECK ("calendar_to_buy_items"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX "calendar_to_buy_items_sort_order_idx" ON "calendar_to_buy_items" USING btree ("sort_order");