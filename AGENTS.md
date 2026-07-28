# Gocheski Schedule Agent Guide

This is a Next.js calendar built with NextSignal, Drizzle ORM, and Neon Postgres.

## Commands

- Install dependencies: `npm install`
- Start development: `npm run dev`
- Type-check: `npm run check`
- Build: `npm run build`
- Generate Drizzle migrations: `npm run db:generate`
- Apply migrations: `npm run db:migrate`
- Open Drizzle Studio: `npm run db:studio`

## Project map

- `app/api/events/route.ts` is a thin NextSignal route wrapper.
- `nextsignal/processes/api/` contains request-facing processes.
- `nextsignal/processes/business/` contains reusable calendar operations.
- `nextsignal/services/` is the app-owned Drizzle repository boundary.
- `db/schema.ts` is the database schema source of truth.
- `drizzle/` contains generated, committed migrations.
- `nextsignal/config.ts` is the only application configuration provider.

## Rules

- Keep route handlers thin and database calls inside services.
- Keep every API and business process explicit about `auth`, `validate`, and `handle`.
- Use result envelopes for expected outcomes instead of throwing.
- Use `@/` imports for application modules.
- Change tables in `db/schema.ts`, then run `npm run db:generate` and inspect the SQL.
- Never edit generated Drizzle snapshots manually.
- Run `npm run check` after process, service, schema, or configuration changes.
- Run `npm run build` after larger changes.

There is currently no authentication, queue, scheduler, recurring process, distributed process, or worker runtime. Do not add those boundaries until the product needs them.
