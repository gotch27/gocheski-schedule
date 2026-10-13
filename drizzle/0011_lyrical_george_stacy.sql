ALTER TABLE "calendar_goals" DROP CONSTRAINT "calendar_goals_valid_range";--> statement-breakpoint
ALTER TABLE "calendar_goals" ALTER COLUMN "starts_on" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_goals" ALTER COLUMN "ends_on" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_goals" ADD CONSTRAINT "calendar_goals_valid_range" CHECK (("calendar_goals"."starts_on" is null and "calendar_goals"."ends_on" is null) or ("calendar_goals"."starts_on" is not null and "calendar_goals"."ends_on" is not null and "calendar_goals"."ends_on" >= "calendar_goals"."starts_on"));