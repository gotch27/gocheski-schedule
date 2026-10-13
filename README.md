# Gocheski Schedule

A tactile weekly calendar built with Next.js, NextSignal, Drizzle ORM, and Neon Postgres. Events can be created, edited, dragged between days, and resized in 15-minute increments.

## Local setup

Add your pooled Neon connection string to `.env.local`:

```dotenv
NEXTSIGNAL_DATABASE__URL=postgresql://user:password@host.neon.tech/database?sslmode=require
ADMIN_TOKEN=replace-with-the-shared-admin-token
SESSION_SECRET=replace-with-the-shared-admin-session-secret
CRON_SECRET=replace-with-a-random-cron-secret
NEXTSIGNAL_NOTIFICATIONS__NTFY_BASE_URL=https://ntfy.sh
NEXTSIGNAL_NOTIFICATIONS__NTFY_TOPIC=replace-with-a-long-random-topic
NEXTSIGNAL_NOTIFICATIONS__NTFY_ACCESS_TOKEN=
NEXTSIGNAL_NOTIFICATIONS__TIME_ZONE=Europe/Skopje
```

Then install dependencies, apply the committed migration, and start the app:

```bash
npm install
npm run db:migrate
npm run dev
```

Open `http://localhost:3000/schedule`.

`ADMIN_TOKEN` and `SESSION_SECRET` should match the values used by `gocheski.com/admin`. The shared signed cookie makes one login valid for both `/admin` and `/schedule` on the production domain.

## Phone notifications

Install the ntfy iPhone app, add a subscription using `https://ntfy.sh`, and enter the exact topic configured in `NEXTSIGNAL_NOTIFICATIONS__NTFY_TOPIC`. Use a long random topic name because an unreserved topic acts like a password. Generate one with `openssl rand -hex 24`.

If the topic belongs to an ntfy account, set `NEXTSIGNAL_NOTIFICATIONS__NTFY_ACCESS_TOKEN` to a publish-capable access token and sign in to the same account in the iPhone app. Add `CRON_SECRET` to the Vercel production environment so Vercel can authenticate the daily notification reconciliation request.

## Calendar behavior

- The visible week runs Monday through Sunday from 7 AM to midnight.
- Drag an event horizontally to change its day and vertically to change its start time.
- Drag the event's bottom grip to change its duration.
- Placement snaps to 15-minute increments and is saved five seconds after the last move, collapsing repeated drops into one update.
- Events can repeat every 1–52 weeks with no end date. Recurrences keep the same local clock time across daylight-saving changes.
- Editing, dragging, resizing, or deleting a recurring occurrence asks whether to change only that event or the entire series.
- Click an event to edit its details or delete it.
- Use arrow keys to move a focused event; use Shift + Up/Down to resize it.

## Event labels

Use the tag button in the calendar toolbar, or **Manage labels** in an event form, to add, rename, recolor, or remove labels. Each label has a name and a color picker. Events display their label name, and the event form shows names beside color swatches.

The labels migration converts the five original colors into editable starter labels and links existing events and occurrence overrides. Renaming or recoloring a label updates all linked events. Removing a label keeps its events and their last color. Label choices follow the series/occurrence edit scope, including explicit **No label** overrides. Label-only series edits preserve occurrence edits and cancellations.

`GET`, `POST`, `PATCH`, and `DELETE /schedule/api/labels` use the shared admin session and NextSignal result envelopes. Apply the migration with `npm run db:migrate` before starting the updated app.

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
- `calendar_event_exceptions` stores one-off edits and cancellations without duplicating recurring series.
- `drizzle.config.ts` configures migration generation and execution.

This version uses the same token authentication as `gocheski.com/admin`. It intentionally has no workers, queues, or scheduled processes.

## Agent access through MCP

The calendar exposes a stateless Streamable HTTP MCP server at **`/schedule/api/mcp`**, within this repository. In production the URL is `https://gocheski.com/schedule/api/mcp`; locally it is `http://localhost:3000/schedule/api/mcp` (use your development server's port).

Configure a separate token in `.env.local` or the deployment environment:

```dotenv
NEXTSIGNAL_MCP__ACCESS_TOKEN=replace-with-a-long-random-token
NEXTSIGNAL_MCP__TIME_ZONE=Europe/Skopje
```

Generate a token with `openssl rand -hex 32`. The endpoint is disabled until the token is configured. Every request must carry `Authorization: Bearer <token>`; the UI's admin cookie does not authenticate MCP requests. Configure your agent's MCP HTTP connection with this URL and header. This personal-token endpoint requires a client that supports custom authorization headers; it does not implement an OAuth login flow.

Example using the official TypeScript MCP SDK:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/schedule/api/mcp"),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.CALENDAR_MCP_TOKEN}` } } }
));
const tools = await client.listTools();
const result = await client.callTool({
  name: "create_todo",
  arguments: { title: "Prepare networking questions", estimatedMinutes: 30 }
});
await client.close();
```

Available tools:

| Area | Tools |
| --- | --- |
| Calendar | `get_calendar_context`, `get_schedule`, `get_event` |
| Events | `create_event`, `update_event`, `move_event`, `duplicate_event`, `delete_event` |
| To-dos and backlog | `list_todos`, `create_todo`, `update_todo`, `schedule_todo`, `unschedule_todo`, `reorder_todos`, `delete_todo` |
| To-buy list | `list_to_buy_items`, `create_to_buy_item`, `update_to_buy_item`, `schedule_to_buy_item`, `unschedule_to_buy_item`, `reorder_to_buy_items`, `delete_to_buy_item` |

Tools share the UI's database and business operations, including reminder validation/reconciliation. Business results contain the NextSignal envelope in both `structuredContent` and text; expected failures set `isError`. Invalid tool arguments are rejected by the MCP SDK before dispatch. Reminder delivery state is returned with saved events. Server failures redact internal error details; read the current state before retrying a mutation, since writes and notification reconciliation are separate operations. Creation is not idempotent.

Read ranges use `weekStart` (inclusive) and `weekEnd` (exclusive), both ISO timestamps with UTC offsets, and can span up to 31 days. List tools return the entire unscheduled list alongside scheduled items in that range; `placement` can be `all`, `unscheduled`, or `scheduled`. Calendar placement uses 07:00 through midnight in the configured time zone, or an explicit `timeZone` override. Events and timed to-dos must fit within one visible day. Event creation requires explicit `startsAt` and `endsAt`; moving a start without an end preserves duration.

Edits accept partial fields and preserve omitted content, reminders, and existing goal/label assignments. Goal and label management is not exposed, and new events use the default color with no associations. Recurring edits and deletions require explicit `scope: "series" | "occurrence"`. Use the original `occurrenceStartsAt` returned by schedule reads to identify an occurrence, even after it moves. Series edits use master content and preserve the series time zone; an optional `occurrenceStartsAt` makes a series move relative to that occurrence. As in the UI, series content/time/recurrence edits reset ordinary occurrence edits and cancellations while retaining explicit goal/label overrides. Duplication copies one occurrence into a standalone event with its existing associations and reminder settings.

Reorder tools require all current unscheduled IDs exactly once. To-dos and purchases are scheduled as their own entity types. They have no completed/purchased status or activity-log model in the current app.

Host validation permits `gocheski.com`, `localhost`, and `127.0.0.1`. Requests without an `Origin` header are supported; browser origins must match the endpoint origin or an explicitly configured origin. Additional deployment hosts/origins can be configured through JSON arrays in `NEXTSIGNAL_MCP__ALLOWED_HOSTS` and `NEXTSIGNAL_MCP__ALLOWED_ORIGINS`. This is a POST request/response endpoint with no persistent SSE sessions. It does not enable cross-origin browser access via CORS.

The thin route lives in `app/api/mcp/route.ts`, transport/authentication helpers in `nextsignal/mcp/`, and authenticated agent processes in `nextsignal/processes/business/agent-calendar.ts`. Database reads remain in services; mutations reuse the existing business processes. No database migration is required.

`npm test` includes MCP client/transport, authentication, validation, partial-edit, and DST checks. To exercise all 22 tools through a running HTTP server against its **test database**, run:

```sh
MCP_TEST_URL=http://127.0.0.1:3100/schedule/api/mcp \
MCP_TEST_TOKEN="$NEXTSIGNAL_MCP__ACCESS_TOKEN" \
node scripts/test-mcp-integration.mjs
```

The integration test reads `NEXTSIGNAL_DATABASE__URL` from the environment or `.env.local`; it must point to the same database as the selected server. It creates and removes named fixtures. Reorder tools operate on whole unscheduled lists, so run this against an isolated test database without concurrent edits.

## Goals

Open `/schedule/goals` to create goals with descriptions, colors, and a manual achieved status. Goals have no dates by default; turn on **Set a date range** to add inclusive start/deadline dates. Goals without dates appear under **Ongoing goals**, while dated goals appear on the timeline. The timeline supports horizontal dragging to browse dates. Arrow keys pan by a week; Home returns to today. Select a goal for weekly statistics and linked tasks.

Events and to-dos can each link to one goal. Event cards show the goal name in its color, including compact cards. Elapsed and upcoming minutes are inferred from scheduled intervals inside the goal period, in the time zone saved when the goal was created. Goals without dates count all linked past work and scheduled one-off tasks; upcoming recurring occurrences are counted for the next 12 weeks. They have no date-progress bar and cannot become overdue. Timed to-dos use their estimated duration; unscheduled and durationless to-dos contribute zero. Overlapping tasks count independently. Changes to past calendar data recalculate the totals; these are not actual-time logs. Marking a goal achieved does not stop accounting. Deleting a goal clears links without deleting tasks.

Goal links follow the existing series/occurrence edit scope. Omitted `goalId` fields preserve links, and explicit `null` unlinks. Goal-only series edits preserve existing occurrence edits and cancellations. Other series edits retain the calendar's existing reset behavior for occurrence fields while preserving explicit goal overrides at their occurrence index, including when the series moves.

The goal API uses the same session authentication and result envelopes as the calendar:

- `GET /schedule/api/goals`: lightweight goal list for selectors.
- `POST`, `PATCH`, `DELETE /schedule/api/goals`: goal management.
- `GET /schedule/api/goals/statistics`: goal details with elapsed/planned minutes, Monday-based weekly buckets, and linked tasks. Reporting does not send or reconcile notifications.

Apply migrations with `npm run db:migrate` before running or deploying this version.

### Goal tests

`npm test` runs deterministic validation, accounting, DST, and recurrence tests without a database. Run `npm run check` and `npm run build` for TypeScript and production verification.

The optional integration test creates and removes uniquely named fixtures. Point it at a locally running server connected to the **same database as `.env.local`**:

```sh
GOALS_TEST_BASE_URL=http://127.0.0.1:3100/schedule \
GOALS_TEST_TOKEN="$ADMIN_TOKEN" \
node scripts/test-integration.mjs
```

It checks authentication, goal and label CRUD, optional goal dates, recurrence exceptions and cancellation preservation, reporting, and foreign-key unlinking without task loss. Cleanup uses services directly so it does not trigger notification reconciliation.
