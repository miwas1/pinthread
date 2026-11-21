# PinThread

**Drawing questions, answered on the drawing.** Construction drawing reviews, threaded at the spot where the clash was found. Built on **Nexconn Chat**.

A site lead drops a pin where a supply duct crosses Beam B-14. The pin opens a Nexconn conversation with the drawing crop, the proposed fix and the reviewers whose sign-off is still needed. When the last required reviewer approves the same proposal on the same drawing revision, the pin turns green on everyone's drawing. The PDF register then records who agreed to what.

![Workspace](design/screens/02-workspace-desktop.png)

- **Live demo:** https://pinthread-d1ya.onrender.com (real Nexconn Chat, North America data centre)
- **Track:** Workplace & Collaboration (Nexconn Build Challenge 2026)
- **Product concept:** [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) · **Build plan:** [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) · **UI design:** [`docs/UI_DESIGN.md`](docs/UI_DESIGN.md)

## Try it in 60 seconds

1. Open the app and choose **Start as MEP lead**. You get your own fresh Meridian Tower project (Level 03, Rev B). No sign-up.
2. The beam clash (RFI-001) is open. Choose **Proposal**, tap a dashed route across the beam, describe the fix, and post it. Both reviewers' tiles now read *In review · Waiting for Structural*.
3. Choose **Invite device** and scan the QR code with your phone to act as **Dana Okafor, Structural engineer**. You can also open the link in another tab. You land on the same spot on the same revision.
4. On the phone, ask *"Does the dashed line show the new route?"* The laptop receives it live. Reply.
5. On the phone, tap **Approve proposal → Confirm approval of v1**. The pin turns green on both screens.
6. Refresh either device, then choose **Export register**. The drawing, the thread and the PDF agree on the proposal, revision, reviewers and record hash.

More to explore:
- **RFI-002** is waiting for the Architect.
- **RFI-003** is blocked by a Structural hold. Post corrective evidence as the site lead, then clear the hold as Structural. Use the avatar menu to switch roles.
- **RFI-004** shows a completed review with a superseded v1.
- **New issue** raises a fresh RFI from any blank spot on the drawing.

## Where Nexconn is used

| Interaction | Client SDK (`@nexconn/chat` 26.5.1) | Platform Chat API (server) |
| --- | --- | --- |
| A person joins a project | `NCEngine.initialize`, `NCEngine.connect` | `/v4/auth/access-token/issue`, `/v4/community-channel/join` |
| Project and rooms | Community subchannels, one private room per pin | `/v4/community-channel/create`, `/subchannel/create`, `/private-subchannel/member/add` |
| Discuss a fix | Text, replies, field photos (`Helper.createSendImageMessageParams` + `sendMediaMessage`) | Seeded field photos (`RC:ImgMsg`) |
| Structured RFI entries | `registerCustomMessages` for 8 `pt:*` types, `MessageHandler.onMessageReceived` | `/v4/community-channel/message/send` |
| Live proposal status | `onCommunityChannelMessageMetadataChanged` | `/v4/community-channel/message/metadata/set` |
| Bring in a discipline | "Jump to pin" alerts with @mentions in discipline subchannels | `message/send` with `hasMention` |
| Live pin colours on every device | Status messages on the `board` subchannel | `message/send` with `shouldPersist: 0` |
| Reopen a room | `BaseChannel.createMessagesQuery().loadNextPage()` | — |
| Reconnect / second device | `ConnectionStatusHandler` (auto-reconnect, kick code 31010) | — |
| Real users on Nexconn | — | `user:connection_status` webhook → `/api/admin/metrics` |

**Integrity:** Postgres is the source of truth.
- Approvals are validated against the displayed proposal version and drawing revision, then written in one transaction together with an outbox of Nexconn messages.
- Repeated taps and reconnects produce exactly one approval per reviewer and version, using an idempotency key plus a unique constraint.
- Clients treat structured messages as signals and refetch from the API. System cards are only trusted from the PinThread bot.

## Architecture

```
Browser (React)  ── REST ─────────────▶  PinThread server (Hono, Node 22) ──▶ Postgres (truth)
   │  NCEngine (WebSocket)                  │  outbox dispatcher ─ signed Platform Chat API ─┐
   └──────────────▶  Nexconn Chat  ◀───────────────────────────────────────────────────────┘
                      community = project · private subchannel = pin · board = live status
```

```
packages/shared   roles, ids, pin-state rules (derivePinState), pt:* message contracts, sheet geometry
apps/server       Hono API, Nexconn gateway (+ local chat for dev), outbox, demo pool/seeding, PDF register
apps/web          React app: drawing canvas, issue rail, rooms, proposal/redline editor, sign-off, tracker
assets/meridian   generator for the fictional C-103 Level 03 Rev B sheet and its pin/route geometry
design/           HTML mockups and rendered screens (see docs/UI_DESIGN.md)
e2e/              Playwright scripts: two-device hero flow, hold/evidence path
```

## Run locally

Requirements: Node 22, pnpm 10, and Postgres 16 (or run `docker compose up -d`).

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm build && node --env-file=.env apps/server/dist/server.mjs
```

Open http://localhost:8787. For development with hot reload, run `pnpm dev`. That runs Vite on :5173, which proxies `/api` to the server on :8787.

Without `NEXCONN_APP_KEY` and `NEXCONN_APP_SECRET`, the app runs a **local chat mode** that stores messages in Postgres and streams them to browsers over Server-Sent Events. It uses the same message shapes, so everything can be developed and tested offline. Set both keys to use Nexconn. The connection chip then reads **Nexconn live**.

### Nexconn console checklist
- **Data centre:** Singapore (`NEXCONN_AREA=SG`), which is the SDK default.
- **Chat settings → Community Channels:** turn on *Restrict message access to members*, *Enable pre-join history access by new member*, and cloud retention.
- **Multi Devices:** keep message synchronization on (the default).
- **Webhooks:** point the URL at `https://<your-app>/api/nexconn/webhook` for `user:connection_status`.
- **Plan:** community channels need the Free or Pro plan (not Starter). Free is valid for one month, so check its expiry against the judging window.

## Tests

```bash
pnpm test
```
Runs the unit tests (status rules, ids, message size), the API integration tests against Postgres (hero flow, idempotency, stale version, holds, PDF), and the Nexconn request-signing tests. The integration tests need a `pinthread_test` database (see `apps/server/test/flow.test.ts`).

```bash
BASE_URL=http://localhost:8787 node e2e/hero.cjs
```

```bash
BASE_URL=http://localhost:8787 node e2e/slab.cjs
```
These end-to-end scripts drive two real browser contexts (desktop and iPhone). Screenshots and the PDF are written to `e2e/out/`.

## Deploy

The `Dockerfile` builds one image that serves the API, the background workers and the web app on `$PORT`. Any container host with managed Postgres works (Railway, Render, Fly.io). Set the variables from `.env.example`:
- `DATABASE_URL`
- `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET`
- `PUBLIC_URL`
- `SESSION_SECRET`, `INVITE_SECRET`, `ADMIN_KEY`

Health check: `/api/healthz`. Metrics (pilot vs demo, webhook-verified connections): `/api/admin/metrics?key=$ADMIN_KEY`.

## Licence

MIT. The Nexconn SDK packages are Apache-2.0. Drawings, people and photos in the demo are fictional and original.
