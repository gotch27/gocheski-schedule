# Gocheski Schedule

A tactile weekly calendar built with Next.js, NextSignal, Drizzle ORM, and Neon Postgres. Events can be created, edited, dragged between days, and resized in 15-minute increments.

## Local setup

Add your pooled Neon connection string to `.env.local`:

```dotenv
NEXTSIGNAL_DATABASE__URL=postgresql://user:password@host.neon.tech/database?sslmode=require
ADMIN_TOKEN=replace-with-the-shared-admin-token
SESSION_SECRET=replace-with-the-shared-admin-session-secret
```

Then install dependencies, apply the committed migration, and start the app:

```bash
npm install
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`.

`ADMIN_TOKEN` and `SESSION_SECRET` should match the values used by `gocheski.com/admin`. The shared signed cookie makes one login valid for both `/admin` and `/schedule` on the production domain.

## Calendar behavior

- The visible week runs Monday through Sunday from 7 AM to 10 PM.
- Drag an event horizontally to change its day and vertically to change its start time.
- Drag the event's bottom grip to change its duration.
- Placement snaps to 15-minute increments and is saved five seconds after the last move, collapsing repeated drops into one update.
- Click an event to edit its details or delete it.
- Use arrow keys to move a focused event; use Shift + Up/Down to resize it.

## Database workflow

The TypeScript schema in `db/schema.ts` is the source of truth.

```bash
npm run db:generate  # Generate a migration after changing the schema
npm run db:migrate   # Apply committed migrations to Neon
npm run db:studio    # Inspect data with Drizzle Studio
```

Generated SQL and schema snapshots are committed under `drizzle/`.

## Application shape

- `app/components/week-calendar.tsx` owns the interactive calendar surface.
- `app/api/events/route.ts` is the thin NextSignal HTTP boundary.
- `app/api/auth/login/route.ts` provides the shared token session endpoint.
- `nextsignal/processes/api/events.ts` owns anonymous request orchestration.
- `nextsignal/processes/business/events.ts` owns reusable event operations.
- `nextsignal/services/index.ts` contains the Drizzle event repository.
- `db/schema.ts` defines the typed Postgres schema.
- `drizzle.config.ts` configures migration generation and execution.

This version uses the same token authentication as `gocheski.com/admin`. It intentionally has no workers, queues, or scheduled processes.
