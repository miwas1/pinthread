# PinThread: Implementation Plan for the Nexconn Chat Challenge

Companion to [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md). That document says *what* PinThread is. This one says *how we build it, in what order, and how each piece earns points*.

> **Source notes.** The challenge site (reskilll.com) and docs.nexconn.ai could not be reached from the build environment, so this plan has not been checked against the live rules page. The Nexconn API details below were read directly from the published packages: **`@nexconn/chat` 26.5.1**, **`@nexconn/engine` 26.5.1**, **`@nexconn/chatui` 26.5.0** (npm, released 2026-11-19), and the OpenAPI spec bundled with **`nexconn-server-sdk-go` v0.1.2**. Items marked **[SPIKE]** are inferred from Nexconn's RongCloud Ultra Group heritage and must be confirmed on Day 0.
>
> **Confirm on the rules page before Day 1:** submission deadline and timezone, video length limit, team size, whether the app URL must stay live through judging, and the exact form fields.

---

## 0. The winning thesis (read this first)

1. **One flawless two-device moment beats ten features.** Judges award 50% for completeness and UX. The beam-clash flow must work every time: propose, alert, question, reply, approve, both pins turn green, refresh, PDF. It must work with no sign-up and no coaching, and it must work on a phone.
2. **Use Nexconn as more than a chat box.** Community = project, private subchannel = pin, custom message types = structured RFI entries, message metadata = live-updating proposal cards, mentions = "waiting on you," and a status channel = live pin colours. The write-up can then point to a dozen distinct SDK-backed interactions, not just "we send text."
3. **The server owns every decision. Nexconn delivers it.** Approvals are validated and stored in Postgres in one transaction, then published through an outbox. Repeated clicks, reconnects, and refreshes can't create a second approval or a pin colour that disagrees with the record. That's the integrity story judges will probe.
4. **Make the judge's path obvious.** Use a guided four-step tracker that ticks itself off, a QR code to bring in the phone, a fresh pre-warmed project per visitor, and a visible "Nexconn live" indicator.
5. **Real traction is a bonus multiplier.** Start recruiting pilot pairs on Day 1, not after the build. Report honest, separated numbers.

---

## 1. Judging criteria → what we build → what we show

| Criterion (weight) | What wins it | Built by | Evidence in submission |
| --- | --- | --- | --- |
| **Required Nexconn Chat SDK usage** (gate) | Client SDK and server API both clearly load-bearing. App Key in the write-up and on the form. A live exchange between two independently connected users. | §4 (whole section) | Write-up table "SDK-backed interactions" (§15.3). Video shows two screens exchanging live. |
| **Completeness & UX, 50%** | Judge opens the URL, sends a message, finishes the review, and retrieves a matching PDF record. Works on desktop and phone. No dead ends, fast, recoverable. | §7, §8, §10, §12 | 2-screen video, e2e test video/GIF in README, live URL with pre-warmed sessions |
| **Innovation & scenario value, 30%** | Location + conversation + reviewers in one place. Show what the site lead sees while one review is outstanding ("In review · Waiting for Structural") and what changes when it arrives. Versioned proposals with redlines, holds with evidence. | §5, §7.2–7.3 | Video beats 1–3, write-up "why spatial threads" section |
| **Business & growth, 20%** | Clear buyer (PM), $49/project/month, free guest reviews, cross-firm invite loop. Real pilot numbers separated from sample activity, plus a practitioner quote given with permission. | §11 | Metrics screenshot, pilot table, quote in write-up |
| **Bonus: real-user traction** | Pilot projects with invited outside reviewers who actually connected to Nexconn | §11 | `/admin/metrics` export, separated by `kind = pilot` |

---

## 2. Scope and priorities

### P0: demo-critical (must ship, never cut)
- Per-visitor demo project (Meridian Tower, Level 03, Rev B) seeded with 4 pins, people, question, field photo
- "Start as MEP lead," plus a second-device join via QR or link as the Structural engineer, with a distinct Nexconn identity per role
- Drawing viewer: pan/zoom (mouse, trackpad, pinch), 3 toggleable layers (Arch/Struct/MEP), pins with **text status + colour + shape**
- Issue room per pin (Nexconn private subchannel): history on open, text, photos, reply
- Pinned issue brief (crop, sheet revision, grid ref, question, required reviewers)
- Proposal with redline route drawn on the crop, cost/schedule impact, versions
- Sign-off card: approve / request change, names who responded and who we're waiting for
- Server-validated, idempotent approvals tied to the proposal version and drawing revision
- Live pin status on all connected devices (Open → In review → Review complete; Blocked)
- "Jump to pin" alert in the discipline subchannel, with a deep link to the same location and revision on any device
- Refresh-safe: the drawing, thread, and register agree after a reload
- PDF register export
- Deployed public URL, public repo, README

### P1: score multipliers (ship unless the schedule slips past the Day 6 cut line)
- Hold / evidence / clear-hold exception path (slab pin)
- Raise a new RFI from a blank spot (pick reviewers, auto-create room, send Jump alerts)
- Issue list with filters (discipline, severity, status)
- Guided demo tracker (4 steps, auto-ticks from real events)
- "Waiting on you" inbox (unread mentions via the SDK)
- Live-updating proposal card via Nexconn message metadata
- Nexconn activity drawer (shows SDK events live; great for video and write-up)
- Pilot mode: upload one sheet (image/PDF page), invite links, metrics dashboard, feedback prompt
- Role switcher (single-device judges)

### P2: stretch
- Proposal diff overlay (v1 ghost route vs v2)
- Reactions ("seen") on cards (SDK 26.5.0 reactions)
- Handover "next shift" read-only summary view
- Per-record QR codes in the PDF linking back to the pin
- Translation of messages (SDK `translateModule`) for multilingual crews

### Out of scope (say so in the write-up as "next")
Multi-sheet sets, revision comparison, CSV export, presence indicators, SSO/accounts, native apps, BIM/IFC import.

---

## 3. Architecture

### 3.1 System diagram

```
 ┌──────────────── Browser (desktop / phone) ────────────────┐
 │ React SPA                                                  │
 │  ├─ Drawing viewer (SVG sheet, layers, pins, redlines)     │
 │  ├─ Issue room (custom React UI on @nexconn/chat)          │
 │  ├─ TanStack Query  ── REST ──────────────┐                │
 │  └─ NCEngine (WebSocket to Nexconn) ◄──┐  │                │
 └────────────────────────────────────────┼──┼────────────────┘
                                          │  │
        live messages, history, uploads   │  │  decisions, state, tokens, PDF
                                          │  ▼
 ┌──────────────── Nexconn cloud ─────────┴──┐   ┌──────── PinThread server (Node) ─────────┐
 │ Community  = project                      │   │ Hono API (zod-validated)                  │
 │  ├─ board        (public, status only)    │◄──┤ Nexconn server client (signed REST, v4)   │
 │  ├─ disc_mep / disc_struct / disc_arch    │   │ Outbox dispatcher (retry, dedupe)         │
 │  └─ p_<pinId>    (private, per pin)       │   │ Demo session pool + seeder + cleanup      │
 └───────────────────────────────────────────┘   │ PDF renderer (react-pdf + resvg)          │
                                                 └───────────────┬───────────────────────────┘
                                                                 │
                                                        ┌────────▼────────┐
                                                        │ Postgres        │
                                                        │ (source of truth)│
                                                        └─────────────────┘
```

### 3.2 The core principle: single source of truth

- **Postgres is authoritative** for pins, proposals, sign-offs, holds, evidence, and status.
- **Nexconn is the conversation and the real-time transport.** It holds discussion history and carries structured cards and live status signals.
- **Structured messages are signals, not truth.** When a client receives `pt:decision` or `pt:pinstate`, it (a) checks that `senderUserId` is the PinThread bot, (b) ignores it if `seq` is not newer than what it has, and (c) refetches the pin from the API. A forged client message cannot turn a pin green.
- Every state change happens in **one DB transaction** that also writes **outbox rows**. The dispatcher publishes to Nexconn after commit and retries on failure. If Nexconn is briefly unavailable, the record is still correct and clients converge on reconnect or refresh.

### 3.3 Stack (and why)

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere, Node 22 | Shared types and state machine between client and server |
| Monorepo | pnpm workspaces | `apps/web`, `apps/server`, `packages/shared` |
| Frontend | Vite + React 19, Tailwind CSS v4, TanStack Query, Zustand, `react-zoom-pan-pinch`, `lucide-react`, `qrcode.react` | Fast to build, pinch-zoom on phones, small bundle |
| Chat SDK | `@nexconn/engine` + `@nexconn/chat` **26.5.1 (pinned exactly)** | Core requirement. Pin exact versions because `@nexconn/chat` peer-requires `@nexconn/engine` `=26.5.1` |
| Chat UI | **Custom React UI**, not `@nexconn/chatui` | ChatUI is a Lit web-component app shell. Our cards must sit inside the drawing UX (bottom sheet on mobile, side panel on desktop) and render redlines. Evaluate ChatUI on Day 0 only as an emergency fallback. |
| Backend | Hono on `@hono/node-server`, zod, `jose` (JWT), pino | Tiny, typed, easy to deploy as one process |
| DB | Postgres 16 + Drizzle ORM | Transactions, `FOR UPDATE`, unique constraints for idempotency |
| PDF | `@react-pdf/renderer` + `@resvg/resvg-js` (SVG crop → PNG) | No headless Chrome needed in production |
| Hosting | One Docker service (Railway / Render / Fly.io) serving API + built SPA, managed Postgres | One origin (no CORS), one deploy, an always-on worker for the outbox and pool |
| Tests | Vitest (unit/integration), Playwright (two-context e2e against the real Nexconn) | Playwright is pre-installed in this environment |
| CI | GitHub Actions: typecheck, unit, build. Scheduled prod smoke e2e during judging. | Catch regressions and outages during the judging window |

### 3.4 Repository layout

```
pinthread/
├─ apps/
│  ├─ web/                    # Vite React SPA
│  │  ├─ src/nexconn/         # engine bootstrap, handlers, message codecs
│  │  ├─ src/drawing/         # viewer, layers, pins, redline tool, crop
│  │  ├─ src/room/            # message list, cards, composer, sign-off bar
│  │  ├─ src/demo/            # landing, join, tracker, role switch
│  │  └─ src/pilot/           # upload sheet, invites
│  └─ server/
│     ├─ src/nexconn/         # signed REST client, typed endpoints
│     ├─ src/domain/          # services: pins, proposals, signoffs, holds
│     ├─ src/outbox/          # dispatcher
│     ├─ src/demo/            # pool, seeder, cleanup
│     ├─ src/pdf/             # register renderer
│     └─ src/db/              # drizzle schema + migrations
├─ packages/shared/           # zod schemas, message contracts, derivePinState, roles
├─ assets/meridian/           # L03 Rev B sheet SVG, field photos, avatars
├─ e2e/                       # Playwright: two-device hero flow, slab flow, PDF check
└─ docs/                      # PRODUCT_SPEC, IMPLEMENTATION_PLAN, nexconn-notes, writeup/
```

---

## 4. Nexconn integration design

### 4.1 Mapping PinThread concepts to Nexconn

| PinThread | Nexconn | Visibility | Created by |
| --- | --- | --- | --- |
| Project (one per demo session or pilot) | **Community channel** `c_<projectId>` | Members only | Server: `POST /v4/community-channel/create` |
| Live pin status feed | Subchannel `board` | Public in community | Server: `POST /v4/community-channel/subchannel/create` (`channelVisibility: 0`) |
| Discipline inboxes ("Jump to pin" alerts) | Subchannels `disc_mep`, `disc_struct`, `disc_arch`, `disc_site` | Public | Server (same endpoint) |
| Issue room (one per pin) | Subchannel `p_<pinShortId>` | **Private**: site lead, required reviewers, PM | Server: create with `channelVisibility: 1`, then `POST /v4/community-channel/private-subchannel/member/add` |
| A participant | Nexconn user `u_<projectId>_<role>` (demo) or `u_<inviteId>` (pilot) | — | Server: `POST /v4/auth/access-token/issue` + `POST /v4/community-channel/join` |
| PinThread system actor | Bot user `pt_bot` | — | Server sends as `fromUserId: "pt_bot"` |

**IDs.** Keep IDs short, ASCII, `[a-z0-9_]` only, and ≤ 20 characters for subchannels (legacy `busChannel` limits) **[SPIKE]**. Use a 10-character nanoid with a lowercase alphanumeric alphabet.

**Limits to respect [SPIKE]:** maximum subchannels per community (legacy default was around 50). A demo uses 5 fixed + 4 seeded + at most 10 judge-created pins = 19, enforced server-side. Community history API: **10 req/s and a 14-day window**, both stated in the spec. Server message send targets **≤ 3 communities per request** with **content ≤ 128 KB** (also stated in the spec).

### 4.2 Server API client (TypeScript)

From the bundled OpenAPI spec and the Go SDK source:
- `POST <domain>/v4/...` with a JSON body
- Headers: `App-Key`, `Nonce`, `Timestamp` (ms), `Signature = hex(sha1(appSecret + nonce + timestamp))`, `X-Request-ID`
- Response `{ code: number, result?: … }`. The spec says `code: 0` means success. **[SPIKE]** Confirm, and treat legacy `200` as success too.
- No default domain is embedded. Use the primary and backup API domains for your app's data center from the Nexconn console or docs (`NEXCONN_API_PRIMARY`, `NEXCONN_API_BACKUP`).

```ts
// apps/server/src/nexconn/client.ts
import { createHash, randomUUID } from 'node:crypto';

export class NexconnServer {
  constructor(private cfg: { appKey: string; appSecret: string; domains: string[] }) {}

  async post<T>(path: string, body: unknown, attempt = 0): Promise<T> {
    const nonce = randomUUID().replace(/-/g, '');
    const timestamp = String(Date.now());
    const signature = createHash('sha1').update(this.cfg.appSecret + nonce + timestamp).digest('hex');
    const domain = this.cfg.domains[Math.min(attempt, this.cfg.domains.length - 1)];
    const res = await fetch(`https://${domain}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'App-Key': this.cfg.appKey, Nonce: nonce, Timestamp: timestamp, Signature: signature,
        'X-Request-ID': randomUUID(),
      },
      body: JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise(r => setTimeout(r, 250 * 2 ** attempt));
      return this.post(path, body, attempt + 1);           // also fails over to backup domain
    }
    const json = await res.json();
    if (!res.ok || (json.code !== 0 && json.code !== 200)) throw new NexconnError(path, res.status, json);
    return json as T;
  }
}
```

Wrap it in a **token-bucket queue** (start at ~20 req/s globally) so seeding bursts never hit rate limits.

### 4.3 Server API calls we use

| When | Endpoint | Body (key fields) |
| --- | --- | --- |
| Create a user identity | `/v4/auth/access-token/issue` | `userId`, `name`, `avatarUrl` → `result.accessToken` (cache in DB, don't re-issue per page load) |
| Create a project | `/v4/community-channel/create` | `userId` (first member, `pt_bot`), `channelId`, `name` |
| Add people to a project | `/v4/community-channel/join` | `channelId`, `userId` (one call per user) |
| Create board/discipline/pin rooms | `/v4/community-channel/subchannel/create` | `channelId`, `subchannelId`, `channelVisibility` 0 or 1 |
| Restrict a pin room to its reviewers | `/v4/community-channel/private-subchannel/member/add` | `channelId`, `subchannelId`, `userIds[]` |
| Post cards (brief, proposal, hold, sign-off, decision, jump, pinstate) | `/v4/community-channel/message/send` | `fromUserId`, `toChannelIds:[c]`, `subchannelId`, `messageType: "pt:…"`, `content` (JSON string), `pushContent`, `shouldPersist`, `isCounted`, `hasMention`, `hasMetadata`, `metadata` |
| Update a proposal card in place | `/v4/community-channel/message/metadata/set` | `channelId`, `subchannelId`, `messageId`, `userId`, `metadata` (≤ 20 keys/request, key ≤ 32 chars, `[A-Za-z0-9+=\-_]`) |
| Audit/repair (optional) | `/v4/community-channel/history-message/list` | Used only by a "verify thread" admin tool |
| Clean up expired demos | `/v4/community-channel/dismiss` | `channelId` |

### 4.4 Client SDK usage (verified names from `@nexconn/chat` 26.5.1)

```ts
// apps/web/src/nexconn/engine.ts
import {
  NCEngine, AreaCode, LogLevel, MessageHandler, ConnectionStatusHandler, ConnectionStatus,
  CommunitySubChannel, CommunitySubChannelIdentifier, BaseChannel,
  SendTextMessageParams, Message,
} from '@nexconn/chat';
import { PT_MESSAGE_TYPES } from '@pinthread/shared';

export async function startEngine(token: string) {
  NCEngine.initialize({ appKey: import.meta.env.VITE_NEXCONN_APP_KEY, areaCode: AreaCode.SG, logLevel: LogLevel.WARN });
  NCEngine.registerCustomMessages(PT_MESSAGE_TYPES);           // before connect, so history decodes
  NCEngine.addConnectionStatusHandler('pt', new ConnectionStatusHandler({
    onConnectionStatusChanged: ({ status }) => connectionStore.set(status),   // drives "Nexconn live" chip
  }));
  NCEngine.addMessageHandler('pt', new MessageHandler({
    onMessageReceived: ({ messages }) => messages.forEach(routeIncoming),     // route by subChannelId
    onCommunityChannelMessageMetadataChanged: ({ messages }) => messages.forEach(patchCard),
    onOfflineMessageSyncCompleted: () => queryClient.invalidateQueries(),     // converge after reconnect
  }));
  const res = await NCEngine.connect({ token });
  if (!res.isOk) throw new Error(`Nexconn connect failed: ${res.code}`);
}

// History when a room opens (also on a fresh device)
export function roomHistory(communityId: string, subId: string) {
  return BaseChannel.createMessagesQuery({
    channelIdentifier: new CommunitySubChannelIdentifier(communityId, subId),
    pageSize: 30, isAscending: false,
  }); // call .loadNextPage() while .hasNext
}

// Ordinary chat goes straight through the client SDK
export const sendText = (c: string, s: string, text: string) =>
  new CommunitySubChannel(c, s).sendMessage(new SendTextMessageParams({ text }));

export async function sendPhoto(c: string, s: string, file: File) {
  const p = await Message.createSendImageMessageParams(await compress(file)); // compress phone photos first
  if (p.isOk) return new CommunitySubChannel(c, s).sendMediaMessage(p.data);
}
```

**Client-SDK interactions (list these in the write-up):**
1. `NCEngine.initialize` / `connect` with a server-issued token, one identity per role, per tab
2. `registerCustomMessages` for 8 PinThread message types
3. Live receipt via `MessageHandler.onMessageReceived`, routed by `CommunitySubChannelIdentifier`
4. Room history via `BaseChannel.createMessagesQuery(...).loadNextPage()`
5. Text messages and replies (`SendTextMessageParams`, `SendReferenceMessageParams`)
6. Field photos (`Message.createSendImageMessageParams` + `sendMediaMessage` with upload progress)
7. Live card updates via `onCommunityChannelMessageMetadataChanged`
8. "Waiting on you" via `BaseChannel.createUnreadMentionMeChannelsQuery` and per-subchannel `unreadCount` badges on pins
9. Connection status (`ConnectionStatusHandler`), including `KICKED_OFFLINE_BY_OTHER_CLIENT` handling
10. Offline catch-up via `onOfflineMessageSyncCompleted`
11. (P2) Reactions with `message.addReaction`

### 4.5 PinThread message contracts (`packages/shared/src/messages.ts`)

Custom types must not start with `RC:` and must be ≤ 32 characters (server spec).

| `messageType` | Persisted | Counted | Sender | Subchannel | Purpose |
| --- | --- | --- | --- | --- | --- |
| `pt:brief` | yes | no | `pt_bot` | `p_*` | Pinned issue brief: crop, sheet/rev, grid, question, reviewers |
| `pt:evidence` | yes | yes | actor | `p_*` | Field evidence card (photo URL, author, time, optional `holdId`) |
| `pt:proposal` | yes | yes | actor | `p_*` | Proposal vN: summary, redline route, cost/schedule. Has **metadata** for live status |
| `pt:signoff` | yes | yes | actor | `p_*` | Approve / request change on vN at Rev B |
| `pt:hold` | yes | yes | actor | `p_*` | Hold placed / evidence added / cleared |
| `pt:decision` | yes | no | `pt_bot` | `p_*` | Status transition record ("Review complete: 2/2 approvals on v2, Rev B") |
| `pt:jump` | yes | yes | `pt_bot` | `disc_*` | "Jump to pin" alert with deep link and **@mention** of the reviewer |
| `pt:pinstate` | **no** (status) | no | `pt_bot` | `board` | Live pin colour/label on every drawing. Transient. Clients refetch on reconnect. |

```ts
type PTBase = { v: 1; projectId: string; pinId: string; seq: number };   // seq = pins.state_seq after this change
export type ProposalMsg = PTBase & {
  proposalId: string; version: number; revision: string;         // "B"
  summary: string; route: Array<[number, number]>;               // normalized sheet coords 0..1
  costImpact?: string; scheduleImpact?: string; supersedesVersion?: number;
  author: { userId: string; name: string; role: Role };
};
export type SignoffMsg = PTBase & {
  signoffId: string; proposalId: string; version: number; revision: string;
  verdict: 'approve' | 'request_change'; comment?: string;
  reviewer: { userId: string; name: string; role: Role };
};
export type DecisionMsg = PTBase & {
  decisionId: string; status: PinStatus; label: string;            // "In review · Waiting for Structural"
  waitingFor: Array<{ userId: string; name: string; role: Role }>;
  approvals: Array<{ name: string; role: Role; at: string; version: number; revision: string }>;
};
export type PinStateMsg = { v: 1; projectId: string; pinId: string; seq: number; status: PinStatus; label: string };
```

**Proposal card metadata** (set on send with `hasMetadata: true`, then updated via `metadata/set`):
`st` = `current | superseded | accepted`, `ap_<role>` = ISO time of approval, `rc_<role>` = ISO time of a change request. The card in scrollback re-renders live ("MEP ✓ 10:42 · Structural waiting"). Superseded versions grey out but keep their approvals visible, as the spec requires.

### 4.6 Delivery semantics

| Concern | Rule |
| --- | --- |
| Duplicate cards | Clients key cards by domain id (`signoffId`, `decisionId`), not by message id. The outbox has a `dedupe_key UNIQUE`, so each domain event is published once. |
| Out-of-order status | Every structured message carries `seq`. The client ignores `seq <= lastSeenSeq[pinId]`. |
| Echo to the actor | The actor's UI updates from the HTTP response immediately. When the server-sent card arrives (or doesn't **[SPIKE]**), it is deduped by domain id. |
| Reconnect | On `CONNECTED` after a drop: invalidate project state, reload the open room's newest page, merge by message id. |
| Nexconn down | If not connected for more than 5 s, poll `GET /api/projects/:id/state` every 5 s and show a "Reconnecting to Nexconn…" chip. Decisions still work because they go through our API. |
| Forged structured messages | Only render `pt:decision`/`pt:pinstate`/`pt:brief`/`pt:jump` if `senderUserId === 'pt_bot'`. Other `pt:*` types render only if the sender is a room member, and pin colour always comes from the API. |
| Same role opened twice | Handle `KICKED_OFFLINE_BY_OTHER_CLIENT`: show "This role is open on another device. Use it here?" and reconnect on confirm. |

### 4.7 Day-0 spike: questions that must be answered (record in `docs/nexconn-notes.md`)

| # | Question | Fallback if "no" |
| --- | --- | --- |
| 1 | Server API success `code` is `0` (or `200`)? Which domains for our data center? Which `AreaCode`? | — (must resolve) |
| 2 | Subchannel ID format, length, and max per community? | Fewer judge-created pins per session |
| 3 | Does the client receive live messages for **all** accessible subchannels without "opening" them? | Keep the room open, use the `board` channel for pins |
| 4 | Private subchannels: must users join the community first? Do non-members get nothing? | Use public subchannels and enforce access in our API/UI |
| 5 | Do server-sent custom messages (`fromUserId` = a real user) render on clients and echo to the sender? | Actor's client sends the card itself after the API returns ids |
| 6 | Must `registerCustomMessages` precede `connect` for history decoding? Is `content` delivered as a parsed object? | Decode JSON string defensively |
| 7 | Do status messages (`shouldPersist: 0`) reach online clients in the community? | Persisted `pt:pinstate` with `isCounted: 0` |
| 8 | Does `metadata/set` fire `onCommunityChannelMessageMetadataChanged` on other clients? | Re-render proposal card from API on `pt:decision` |
| 9 | Does `createMessagesQuery` on a fresh device return remote history for a community subchannel? | Server-side history endpoint proxy |
| 10 | Built-in image message content format when seeding via the server (`RC:ImgMsg`)? | Seed field photo as `pt:evidence` card instead |
| 11 | Do `mentionedInfo` + `hasMention: 1` surface in `createUnreadMentionMeChannelsQuery`? | Our own "waiting on you" from API state |
| 12 | Token lifetime and expiry behaviour? | Refresh token on `TOKEN_INCORRECT` |

**Spike exit criterion:** a throwaway page where two browser tabs (two users) exchange text in a private subchannel, the server posts a `pt:proposal`, its metadata is updated, both tabs see the change, and a refresh reloads history. Commit as `spikes/nexconn-walking-skeleton`.

---

## 5. Domain model and rules

### 5.1 Postgres schema (Drizzle, abbreviated)

```sql
projects        (id pk, kind 'demo'|'pilot', name, community_id unique, created_at, expires_at)
users           (id pk, project_id fk, nexconn_user_id unique, display_name, role, firm, avatar_url,
                 nexconn_token, can_hold bool)
sheets          (id pk, project_id fk, number 'C-103', title 'Level 03 Coordination Plan')
sheet_revisions (id pk, sheet_id fk, rev 'B', kind 'svg'|'raster', asset_id, width, height, issued_at,
                 is_current bool)
pins            (id pk, project_id fk, sheet_revision_id fk, x real, y real,  -- normalized 0..1
                 grid_ref, title, question, discipline, severity, subchannel_id unique,
                 status, status_label, state_seq int, current_proposal_id, created_by, created_at)
pin_reviewers   (pin_id, user_id, role, required bool, primary key (pin_id, user_id))
proposals       (id pk, pin_id fk, version int, author_id, summary, route jsonb,
                 cost_impact, schedule_impact, sheet_revision_id, nexconn_message_id,
                 created_at, unique (pin_id, version))
signoffs        (id pk, pin_id, proposal_id fk, sheet_revision_id, reviewer_id, verdict,
                 comment, created_at, updated_at, unique (proposal_id, reviewer_id, sheet_revision_id))
holds           (id pk, pin_id, placed_by, reason, clear_condition, status 'active'|'cleared',
                 cleared_by, cleared_at, created_at)
evidence        (id pk, pin_id, hold_id null, author_id, image_url, caption,
                 nexconn_message_id unique null, created_at)
events          (id pk, pin_id, project_id, type, actor_id, payload jsonb, created_at)   -- append-only audit
outbox          (id pk, dedupe_key unique, kind, payload jsonb, attempts, next_attempt_at,
                 sent_at, nexconn_message_id, last_error)
idempotency     (key pk, user_id, response jsonb, created_at)
invites         (id pk, project_id, role, display_name, token_hash, accepted_at, first_connected_at)
assets          (id pk, mime, bytes bytea, created_at)        -- pilot sheet uploads (swap for R2 if needed)
analytics       (id pk, project_kind, project_id, user_id, name, props jsonb, at)
```

### 5.2 Pin status: one pure function, shared by client and server

```ts
// packages/shared/src/derivePinState.ts
export function derivePinState(f: PinFacts): PinState {
  if (f.activeHold) return {
    status: 'blocked', label: `Blocked · Hold by ${f.activeHold.placedByRole}`,
    waitingFor: f.activeHold.evidenceSubmitted ? [f.activeHold.placedBy] : [f.siteLead],
    outstanding: f.activeHold.evidenceSubmitted ? `Assess evidence and clear hold` : f.activeHold.clearCondition,
  };
  if (!f.currentProposal) return { status: 'open', label: 'Open', waitingFor: f.requiredReviewers, outstanding: 'Proposal needed' };
  const approved = new Set(f.signoffs
    .filter(s => s.proposalId === f.currentProposal!.id && s.revisionId === f.currentRevisionId && s.verdict === 'approve')
    .map(s => s.reviewerId));
  const missing = f.requiredReviewers.filter(r => !approved.has(r.userId));
  if (missing.length === 0) return { status: 'complete', label: 'Review complete', waitingFor: [], outstanding: null };
  return { status: 'in_review', label: `In review · Waiting for ${roleList(missing)}`, waitingFor: missing,
           outstanding: `Approval of v${f.currentProposal.version} by ${nameList(missing)}`,
           changeRequestedBy: latestChangeRequests(f) };
}
```

| Event | Effect |
| --- | --- |
| Pin created | `Open` |
| Proposal v1 posted | `In review · Waiting for <all required>` |
| Reviewer approves the **current** version on the **current** revision | Removed from the waiting list. Last one → `Review complete` (green) |
| Reviewer requests a change | Stays `In review`. Card shows "Change requested by Structural." Proposer revises. |
| Proposal edited (new version) | Old version's approvals stay visible on the old card (`st=superseded`). New version needs fresh approvals for everyone. |
| Hold placed | `Blocked` (takes precedence). The hold author's approval on the current version is withdrawn (recorded as an event). |
| Evidence added to hold | Still `Blocked`. Outstanding: "Structural to assess evidence." |
| Hold cleared | Back to `In review` (or `Review complete` if all approvals still stand) |

**Exhaustive tests:** a table-driven Vitest suite covering every row above plus edge cases: stale version, revision mismatch, duplicate approval, non-required reviewer, hold while complete.

### 5.3 Authorization matrix

| Action | Site lead | Required reviewer | Non-required member | Notes |
| --- | --- | --- | --- | --- |
| Raise RFI, choose reviewers | ✓ | — | — | Demo: MEP lead may also raise |
| Post text/photo | ✓ | ✓ | ✓ (if room member) | Via client SDK |
| Post proposal / new version | — | ✓ | — | |
| Approve / request change | — | ✓ (only their own role) | — | Must match displayed `proposalId` + `revision`, otherwise 409 |
| Place hold | — | ✓ if `can_hold` (Structural, Architect) | — | |
| Add corrective evidence | ✓ | ✓ | — | |
| Clear hold | — | Hold author's role | — | |
| Export register | ✓ | ✓ | ✓ | Spec: site lead. Allow all for demo. |

### 5.4 Idempotency and concurrency (the "repeated click" guarantee)

1. The client generates an `Idempotency-Key` (uuid) **when the sign-off card renders**, not on click. Double-clicks send the same key. The button disables on first click.
2. Server: `BEGIN; SELECT … FROM pins WHERE id=$1 FOR UPDATE;` validates the role, that `proposalId == pins.current_proposal_id`, and that `revisionId == current revision`.
3. `INSERT INTO signoffs … ON CONFLICT (proposal_id, reviewer_id, sheet_revision_id) DO UPDATE SET verdict = EXCLUDED.verdict WHERE signoffs.verdict <> EXCLUDED.verdict` (approve after request-change is allowed. A second identical approval is a no-op).
4. Recompute `derivePinState`, bump `state_seq` only if the state changed, write `events` and `outbox` rows, store the idempotency response, `COMMIT`.
5. Response returns the full pin state. A replayed key returns the stored response.
6. A unique constraint is the last line of defence. An e2e test fires 5 parallel approve requests and asserts exactly one sign-off row and one `pt:signoff` card.

---

## 6. HTTP API (all JSON, zod-validated, `Authorization: Bearer <session JWT>`)

| Method & path | Purpose |
| --- | --- |
| `POST /api/demo/sessions` `{role}` | Claim a pre-warmed demo project. Returns `{session, me, nexconnToken, projectId, joinLinks}` |
| `POST /api/demo/join` `{projectId, role, sig}` | Second device / tab joins as another role (HMAC-signed link, 24 h expiry) |
| `POST /api/demo/switch-role` `{role}` | Single-device role switcher (P1) |
| `GET /api/me` | Identity + Nexconn token (cached) |
| `GET /api/projects/:id/state` | Sheet + revision, members, all pins with derived state and `seq` (drives the drawing) |
| `GET /api/pins/:id` | Full record: brief, proposals (all versions), sign-offs, holds, evidence, `waitingFor`, `outstanding` |
| `POST /api/projects/:id/pins` | Raise RFI `{x,y,title,question,discipline,severity,reviewers[]}`. Creates subchannel, members, brief, jump alerts |
| `POST /api/pins/:id/proposals` | New proposal version `{summary, route, costImpact, scheduleImpact, basedOnVersion}` |
| `POST /api/pins/:id/signoffs` | `{proposalId, revision, verdict, comment}` + `Idempotency-Key` |
| `POST /api/pins/:id/holds` | `{reason, clearCondition}` |
| `POST /api/holds/:id/evidence` | `{imageUrl, caption, nexconnMessageId}` (photo uploaded via SDK first) |
| `POST /api/holds/:id/clear` | `{note}` |
| `POST /api/pins/:id/nudge` | Re-send `pt:jump` to whoever is outstanding (rate-limited) |
| `GET /api/projects/:id/register.pdf` | Register export |
| `POST /api/pilot/projects` | Create pilot project (access-code gated), upload sheet |
| `POST /api/pilot/projects/:id/invites` | Create invite links per role |
| `GET /api/admin/metrics` | Pilot vs demo metrics (admin key) |
| `GET /healthz`, `GET /status` | Liveness. Nexconn reachability (no secrets exposed) |

---

## 7. Frontend

### 7.1 Routes

| Route | Screen |
| --- | --- |
| `/` | Landing: one-line pitch, "Start as MEP lead" (primary), "Start as Site lead," a 4-step preview, "Built on Nexconn Chat" |
| `/p/:projectId?pin=:pinId&rev=B` | Main workspace: drawing + room/list |
| `/j/:projectId/:role?sig=…` | Join as another role (second device). Shows who you'll be, then "Join" |
| `/pilot/new`, `/i/:inviteToken` | Pilot creation and invite acceptance |
| `/admin/metrics` | Metrics (admin key) |

**Identity per tab:** the session JWT and Nexconn token live in `sessionStorage`, not cookies. Two tabs in one browser can then be MEP and Structural, and refreshing a tab keeps its identity (needed for demo step 4).

### 7.2 Drawing viewer

- **Sheet asset:** a hand-built **SVG** for *Meridian Tower, C-103 Level 03 Coordination Plan, Rev B*. Gridlines A–H × 1–9 with bubbles, columns, beams with marks (B-14 between C/4 and D/4), walls and cores, supply duct runs, electrical riser ER-2, slab pour zone 3B, curtain wall along grid A, and a title block with revision table (Rev A, Rev B). Layers are `<g id="layer-arch|struct|mep">` with distinct line colours, so toggles flip `display`. Generate it from a small TS script (`assets/meridian/build-sheet.ts`) so coordinates for pins and crops come from the same source.
- **Pan/zoom:** `react-zoom-pan-pinch` with min/max zoom, double-tap zoom, and "fit sheet" / "zoom to pin" buttons. Pins are rendered in an **overlay** positioned from normalized sheet coordinates and counter-scaled, so they stay finger-sized at every zoom.
- **Coordinates:** pins store `(x, y)` in `[0,1]` relative to the sheet's viewBox. Deep link `?pin=` → `zoomToElement`. Desktop and phone show the same spot.
- **Pin visual:** colour + shape + text label (accessibility):
  - Open: blue circle, label "Open"
  - In review: amber half-filled circle, label "In review · Waiting for Structural"
  - Blocked: red octagon, label "Blocked"
  - Review complete: green circle with check, label "Review complete"
  - Unread badge from the subchannel `unreadCount`. Pulse animation on state change.
- **Crop:** an SVG `<use>` of the same sheet with a tight `viewBox` around the pin (≈ 12% sheet width). Used in the brief card, proposal composer, PDF (server renders the same crop with resvg).
- **Redline tool** (proposal composer): click/tap to add points, drag to move, double-tap/Enter to finish, undo. Stored as normalized points. Rendered dashed magenta with arrowheads on the crop, the main drawing (when pin selected), and the PDF. Earlier versions can appear as a grey ghost (P2 diff).
- **Raise RFI:** long-press (mobile) or "+ New issue" then click (desktop) on a blank spot → sheet panel with title, question, discipline, severity, reviewers (checkboxes with role chips), optional photo.

### 7.3 Issue room

Layout: desktop right panel at 420 px; mobile **bottom sheet** with three snap points (peek / half / full) so the drawing stays visible.

```
┌ Brief (sticky, collapsible) ───────────────────────────────┐
│ RFI-001 Supply duct clashes with Beam B-14   [In review ●] │
│ C-103 Rev B · Grid C–D/4 · High · Raised by Priya (Site)   │
│ [crop with pin]  Q: "Duct SD-3 crosses B-14 at …"          │
│ Reviewers: MEP ✓ 10:42 · Structural ⏳ waiting             │
├ Thread ────────────────────────────────────────────────────┤
│ 📷 Field photo (Priya, 07:42)                              │
│ ▣ Proposal v1 (Marco, MEP) [crop+dashed route] cost/sched  │
│   MEP ✓  Structural waiting          (live via metadata)   │
│ Dana: "Does the dashed line show the new route?"           │
│ Marco: "Yes, drops 150 mm under B-14 between C and D."     │
│ ◆ Decision: Review complete, 2/2 approvals on v1, Rev B    │
├ Sign-off bar (sticky, only for required reviewers) ────────┤
│ Reviewing Proposal v1 on Rev B  [Request change] [Approve] │
├ Composer ──────────────────────────────────────────────────┤
│ [📷] [＋ Proposal] [⛔ Hold] [ Message…            ] [Send] │
└────────────────────────────────────────────────────────────┘
```

- Card renderers per `messageType`. Unknown types fall back to "Unsupported message."
- The sign-off bar always names the version and revision it will approve. A 409 on a stale version shows "Proposal changed to v2. Review the new route" and scrolls to it.
- Optimistic text sends with a pending state, retry on failure, image upload progress from `onUploadProgress`.
- "Reply" uses the reference message, so the structural question can quote the proposal card.
- Empty, loading, error, and offline states for everything.

### 7.4 Issue list
Drawer or tab next to the room with counts per status, filter chips (Discipline: Arch/Struct/MEP/Elec; Severity; Status), sort by "waiting longest," and tap → zoom to pin. A "Waiting on you" section at the top uses unread mentions.

### 7.5 Guided demo tracker (P1, high UX value)
A compact, dismissible checklist pinned at the top-left:
1. Propose the reroute (ticks when your `pt:proposal` posts and you approved for MEP)
2. Bring in Structural on another device (QR, ticks when the Structural user connects: server records `first_connected_at` via a ping after connect)
3. Structural approves (ticks on `Review complete`)
4. Refresh and export the register (ticks when the PDF downloads)
Each step has a "Show me" link that zooms to the relevant UI. Emit analytics events for each step to measure demo completion.

### 7.6 "Invite second device" panel
Shows a big QR code for `/j/:projectId/struct?sig=…`, a copy-link button, and "Open in new tab." Explains: "Open this on your phone to act as Dana Okafor, Structural engineer."

### 7.7 Nexconn activity drawer (P1)
Toggle in the footer: a live log of SDK events, such as `connected as u_x_struct`, `onMessageReceived pt:proposal in p_b14`, `metadata changed ap_struct`, `pt:pinstate seq 7 → complete`. Judges *see* the SDK at work, and it's a great B-roll shot for the video.

### 7.8 Quality bar
- First load ≤ 2.5 s on 4G (code-split the PDF viewer, lazy-load the SDK after the drawing paints)
- Touch targets ≥ 44 px. Readable text at 360 px width. No horizontal scroll.
- WCAG AA contrast. Status never conveyed by colour alone. Keyboard-operable on desktop.
- All times shown in the viewer's local timezone with relative hints

---

## 8. Demo session system

- **Pool:** a background worker keeps **N = 5** fully seeded demo projects ready. Seeding takes about 30 Nexconn calls, so it must never happen on a judge's click. `POST /api/demo/sessions` claims one atomically (`UPDATE … SET claimed_at = now() WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`) and the worker refills. If the pool is empty, seed synchronously with a friendly progress screen.
- **Identities:** each project has its own users (`u_<pid>_site`, `_mep`, `_struct`, `_arch`) with distinct tokens, so two devices are two independently connected Nexconn users.
- **TTL:** demo projects expire after 48 h. An hourly cleanup dismisses the community and deletes rows. A rate limit on claims per IP (e.g., 20/h) prevents abuse.
- **Reset:** "Start over" claims a fresh project, so the next visitor can try the same decision.

## 9. Seed content: Meridian Tower, Level 03, Rev B

People (fictional):

| Role | Name | Firm | Notes |
| --- | --- | --- | --- |
| Site lead | Priya Shah | Halden Construction | Raises RFIs, exports register |
| MEP lead | Marco Ruiz | Northline MEP | Default demo role |
| Structural engineer | Dana Okafor | Okafor Structural | Second-device role. `can_hold` |
| Architect | Lena Park | Park & Vale Architects | `can_hold` |

Pins:

| # | Title | Grid | Discipline / severity | Required reviewers | Seeded state |
| --- | --- | --- | --- | --- | --- |
| RFI-001 | Supply duct SD-3 crosses Beam B-14 | C–D/4 | MEP / High | MEP, Structural | **Open**: site lead's question + field photo. *Hero.* |
| RFI-002 | Electrical riser ER-2 penetration through core wall | E/7 | Elec / Medium | Architect, MEP | **In review**: proposal v1 by MEP, MEP approved, waiting for Architect |
| RFI-003 | Slab pour 3B: honeycombing at edge | F–G/2–3 | Struct / High | Structural, Architect | **Blocked**: hold by Structural "Core test results or repair method statement required" |
| RFI-004 | Curtain wall bracket spacing at grid A | A/1–3 | Arch / Low | Architect, Structural | **Review complete**: v2 approved by both (v1 superseded, shows versioning) |

Assets: one sheet SVG, three field photos (shoot or generate our own original images of a duct/beam mock-up, a slab edge, a bracket. **No copyrighted stock**), and four avatars (initials).

Chat timestamps from server sends will read "just now." The brief and evidence cards show the domain timestamps from our DB (backdated "Today 07:42"). That's acceptable, and noted as a known limitation.

## 10. PDF register

- **Endpoint:** `GET /api/projects/:id/register.pdf`, rendered server-side by `@react-pdf/renderer`.
- **Single builder:** `buildDecisionRecord(pinId)` feeds the API (`GET /api/pins/:id`), the decision cards, and the PDF. That's what guarantees "drawing, thread, and PDF agree."
- **Cover:** project, sheet, revision, exported-by, export time, counts by status.
- **One section per pin:**
  - Header with RFI number, title, status label (text, not just colour)
  - Crop PNG (resvg render of the same SVG + pin + redline of the accepted/current proposal)
  - Sheet / revision / grid / discipline / severity, and the question
  - **Accepted proposal** (version, summary, cost/schedule impact). For incomplete pins, the current proposal is marked "Not yet accepted."
  - **Sign-offs table:** name, role, firm, verdict, time, proposal version, revision. Superseded-version approvals are listed separately as history.
  - Holds: reason, clear condition, evidence, cleared by/at
  - **Outstanding action** for Open/Blocked/In review, e.g. "Waiting for Dana Okafor (Structural) to approve v1"
  - Record hash: first 8 chars of sha256 over the decision record. The same hash shows in the app's pin panel, so anyone can check that the PDF matches the live record.
  - (P2) QR back to the pin
- **Test:** parse the PDF text (`pdf-parse`) in e2e and assert names, revision, version, and status match the API.

## 11. Pilot mode and traction (start recruiting Day 1)

### 11.1 Product features (P1)
- **Create a pilot project** (access code): project name, upload **one sheet** (PNG/JPG, or the first page of a PDF rasterised in the browser with pdf.js), revision label. The viewer supports `raster` sheets (layers hidden).
- **Invite links per person** (role, name): signed single-use magic links, no account, free for guests. Share by WhatsApp or email manually.
- **Feedback prompt** after a pilot pin reaches Review complete: "What was confusing?", "Can we quote you?" (explicit consent checkbox)
- **Metrics** (`/admin/metrics`), always split by `project.kind`:
  - Pilot participants **active on Nexconn** (distinct users with a successful `connect`)
  - Invitations sent / accepted (opened and connected)
  - Issues raised / completed, median time to complete
  - Second issue opened voluntarily (yes/no per project)
  - Demo sessions started / demo flows completed (tracker step 4)

### 11.2 Pilot playbook (workstream C)
1. **Recruit (Day 1–6):** 5 to 8 contacts (site coordinators and consultants) from personal networks, local contractors, construction communities, and alumni. Ask: "Can you resolve one real drawing question with a consultant using a free tool, 20 minutes?"
2. **Run (Day 7–11):** the coordinator uploads their sheet, drops a pin, and invites the consultant. **Don't coach.** Observe over video call with consent.
3. **Record** (template in `docs/pilot/observation-template.md`):
   - Did the consultant follow the invite? Did both complete the review without coaching? Did anyone open a second issue voluntarily?
   - The next person on shift is asked to find the accepted route and name its reviewers. Record whether they succeeded.
   - What they actually did, one point of confusion, and the change we made in response (ship it, then note the commit)
4. **Report honestly:** real pilot numbers vs sample/demo activity in separate rows. Quote only with written permission.

### 11.3 Business narrative for the write-up
- **Buyer:** the project manager who chases answers across firms. **Price to test:** $49 per project per month. **Guests free**, so a subcontractor can answer one question without a purchasing decision.
- **Growth loop:** every RFI invites outside reviewers from other firms. Each guest experiences the product on a real problem, and those firms run their own projects and become buyers.
- **Why Nexconn:** cross-firm, multi-device, real-time messaging with history and private rooms, without running our own chat infrastructure. Start inside Nexconn's free growth credit.
- **Next:** drawing uploads at scale, multi-sheet sets, revision comparison that flags decisions for re-review and keeps earlier approvals on the drawing they were given against, CSV export, presence.

---

## 12. Testing strategy

| Layer | What | Tooling |
| --- | --- | --- |
| Unit | `derivePinState` table tests, authorization matrix, message contract (zod) round-trips, signature function vs. Go SDK algorithm | Vitest |
| Integration | API services against a real Postgres (testcontainers or CI service). Nexconn replaced by a `FakeChatGateway` that records calls. Idempotency (5 parallel approvals → 1 row, 1 outbox row), stale-version 409, hold precedence | Vitest |
| Contract | Nightly: real Nexconn sandbox calls (token, community, subchannel, send, metadata) | Vitest, tagged `@live` |
| **E2E: hero flow** | Two Playwright browser contexts (desktop 1440×900 + iPhone 14 emulation) against staging/prod with real Nexconn: MEP proposes and approves → both show "Waiting for Structural" → Structural opens the jump link, asks a question → MEP sees it and replies → Structural approves → **both pins green within 3 s** → reload both → still green → download PDF → text matches | Playwright (`--trace off` by default) |
| E2E: slab flow | Site lead adds evidence → Structural clears hold → reviewers finish → complete | Playwright |
| E2E: resilience | Approve while offline (route blocked), then reconnect → single approval. Double-click approve → single card. | Playwright |
| Visual | Screenshots of pins/cards at 360 px and 1440 px | Playwright |
| Prod smoke | GitHub Actions cron every 30 min during judging runs the hero e2e on prod and alerts (email/Slack webhook) on failure | Actions |

---

## 13. Deployment and operations

- **Environments:** `local` (Docker Postgres), `staging`, `prod`. A separate Nexconn app (App Key) for staging vs prod if the console allows.
- **Environment variables:**
  - `DATABASE_URL`
  - `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET` (server only, never in the client bundle)
  - `NEXCONN_API_PRIMARY`, `NEXCONN_API_BACKUP`
  - `VITE_NEXCONN_APP_KEY`, `VITE_NEXCONN_AREA`
  - `SESSION_JWT_SECRET`, `INVITE_HMAC_SECRET`, `ADMIN_KEY`, `PILOT_ACCESS_CODE`
- **Process:** one Node process runs API, outbox dispatcher (in-process loop, `LISTEN/NOTIFY` wake), pool worker, and hourly cleanup. Health checks on `/healthz`.
- **Monitoring:** pino JSON logs, an uptime monitor on `/healthz`, the prod smoke e2e (above), and a `/status` page showing Nexconn reachability and pool depth.
- **Graceful degradation:** polling fallback (§4.6), friendly toasts for Nexconn errors with retry, and seeding falls back to synchronous.
- **Security:** App Secret only on the server. Zod validation everywhere. Size caps (content ≤ 16 KB for our cards, images compressed ≤ 1.5 MB). HMAC-signed, expiring join/invite links. Rate limits on demo claims, pin creation, nudges. No PII in demo data. The App Key is public by design (it ships in the client and the write-up).
- **Licences:** Nexconn packages are Apache-2.0. Our repo is MIT. All seed images and drawings are original.

---

## 14. Schedule

The deadline couldn't be confirmed, so this is a **12-working-day** plan. Map Day 12 to the real deadline minus one day of buffer. Workstreams: **A** = backend + Nexconn, **B** = frontend, **C** = content, demo, pilots, video. Solo builders do A → B in order and run C in the evenings.

| Day | A: Backend / Nexconn | B: Frontend | C: Content / growth | Milestone |
| --- | --- | --- | --- | --- |
| 0 | Nexconn console app, keys, data centre. **Spike §4.7** (all 12 questions). Repo scaffold, CI, deploy "hello" to prod URL | Scaffold Vite app, Tailwind, routing | Read rules page. Confirm deadline, video limits, form fields. Start pilot outreach list. | Walking skeleton live on a public URL |
| 1 | DB schema + migrations, `derivePinState` + tests, Nexconn server client (signing, queue, retries) | SVG sheet generator v1 (grid, beams, ducts, layers) | Write seed script content, people, questions. Shoot/generate field photos. | State machine 100% tested |
| 2 | Demo session pool + seeder + claim API, session JWT, join links | Drawing viewer: pan/zoom/pinch, layers, pin overlay, deep link | Outreach: book 3+ pilot sessions for Day 7–11 | Judge can claim a seeded project and see pins |
| 3 | Pins/state API, outbox dispatcher, `pt:brief`/`pt:pinstate` publishing | Engine bootstrap, connection chip, room history, text + photo send, card renderers (brief, evidence) | Draft write-up skeleton | Two tabs chat live in a pin room |
| 4 | Proposals API + `pt:proposal` with metadata, sign-offs with idempotency + 409 | Proposal composer + redline tool, proposal card (live metadata), sign-off bar | Storyboard video | Propose + approve works in one tab |
| 5 | Decision cards, jump alerts with mentions in `disc_*`, nudge | Live pin colours via `board`, waiting-on-you inbox, QR join panel, kicked-offline modal, polling fallback | Rehearse the hero flow on phone + laptop | **Hero flow (steps 1–3) on two real devices** |
| 6 | Holds/evidence/clear APIs, new-RFI API (subchannel + members + brief + jumps) | Hold & evidence UI, raise-RFI flow, issue list + filters | **Cut-line review** (§14.1) | All 4 seeded pins fully playable |
| 7 | PDF register (`buildDecisionRecord`, resvg crops), record hash | Guided tracker, Nexconn activity drawer, role switcher | Pilot sessions start | Step 4 (refresh + PDF) works |
| 8 | Pilot APIs: create project, raster sheet upload, invites, metrics, analytics events | Pilot create/upload UI, invite accept, feedback prompt | Run pilots, log observations, ship fixes | Pilot mode live |
| 9 | Hardening: rate limits, cleanup cron, error paths, `/status` | Mobile polish (bottom sheet, 360 px), a11y pass, performance budget | Pilots continue. Collect quotes with consent. | Feature freeze (evening) |
| 10 | Prod e2e suite green, scheduled smoke, pool sizing | Bug bash from e2e + pilot findings | **Record video** (2 takes), screenshots | Release candidate |
| 11 | Final deploy, tag `v1.0`, README polish | Final visual QA | Write-up PDF with App Key + SDK table + metrics. Fill the submission form. | **Submit (one day early)** |
| 12 | Buffer / watch smoke alerts | — | Answer judge questions | Judging window monitoring |

### 14.1 Cut lines
- **Behind at the end of Day 6?** Drop pilot sheet upload (run pilots inside a fresh demo-style project with their own question + photo), the activity drawer, the role switcher, and P2s.
- **Behind at the end of Day 8?** Drop guided tracker automation (keep a static checklist) and issue-list filters beyond status.
- **Never cut:** two-device live flow, server-validated idempotent approvals, refresh consistency, PDF register, mobile layout, deployed URL.

---

## 15. Submission package

### 15.1 Repository (public)
README with: one-paragraph pitch, live URL + "how to try in 60 seconds," GIF of the two-device flow, architecture diagram, **"Where Nexconn is used" table** (§15.3), local setup (`pnpm i && docker compose up -d && pnpm dev`), env vars, test commands, licence, credits. Keep `.env` out of git, add `.env.example`, and run a secret scan before making the repo public.

### 15.2 Demo video (target ≤ 3:00 unless the rules say otherwise; laptop + phone on screen together)

| Time | Shot | Voice-over beat |
| --- | --- | --- |
| 0:00–0:15 | Site photo of a duct hitting a beam, then the drawing with the red pin | "Has Structural agreed to this route, and on which drawing?" |
| 0:15–0:35 | Landing → Start as MEP lead → pin opens: brief, photo, reviewers | Location, conversation, reviewers in one place |
| 0:35–1:00 | Draw dashed reroute, post, approve for MEP → both screens show "In review · Waiting for Structural" | What the site lead sees while a review is outstanding |
| 1:00–1:30 | Phone: Jump to pin notification → same spot, same Rev B → asks "Does the dashed line show the new route?" → laptop receives, replies | Live delivery between two independently connected Nexconn users |
| 1:30–1:50 | Phone: Approve → **both pins turn green**. Open pin: two named approvals on Rev B. Double-tap approve still shows one. | Decision verified server-side, one approval per reviewer and version |
| 1:50–2:10 | Refresh both → export PDF → page shows same proposal, revision, names, hash | Handover record for the next shift |
| 2:10–2:30 | Slab pin: hold → evidence → clear → complete (sped up) | Exception path |
| 2:30–2:45 | Architecture card + activity drawer | The SDK interactions, by name |
| 2:45–3:00 | Pilot numbers + quote, $49/project, guests free | Traction and business |

Record with real devices (phone screen mirrored), 1080p, captions burned in, no dead air.

### 15.3 Write-up PDF (include the **Nexconn App Key** on page 1)
1. Problem and scenario (beam clash), plus who the buyer is
2. Product walkthrough with screenshots (four steps + exception path)
3. **Nexconn SDK-backed interactions table:**

| Interaction | Client SDK | Server API |
| --- | --- | --- |
| Join project as a person | `NCEngine.initialize`, `NCEngine.connect` | `/v4/auth/access-token/issue`, `/v4/community-channel/join` |
| Project and rooms | `CommunitySubChannel`, `CommunitySubChannelIdentifier` | `/v4/community-channel/create`, `/subchannel/create`, `/private-subchannel/member/add` |
| Discuss a fix | `SendTextMessageParams`, `SendReferenceMessageParams`, `Message.createSendImageMessageParams` + `sendMediaMessage` | — |
| Structured RFI entries | `registerCustomMessages` (8 `pt:*` types), `MessageHandler.onMessageReceived` | `/v4/community-channel/message/send` |
| Live proposal status | `onCommunityChannelMessageMetadataChanged` | `/v4/community-channel/message/metadata/set` |
| Bring in a discipline | `createUnreadMentionMeChannelsQuery`, `unreadCount` | `message/send` with `hasMention` in `disc_*` |
| Live pin colours | `onMessageReceived` on `board` | `message/send` with `shouldPersist: 0` |
| Reopen a room | `BaseChannel.createMessagesQuery().loadNextPage()` | — |
| Reconnect safety | `ConnectionStatusHandler`, `onOfflineMessageSyncCompleted` | Outbox with dedupe keys |

4. Integrity design: server authority, idempotency, seq ordering, forged-message defence
5. UX decisions: mobile bottom sheet, status text + shape, guided tracker
6. Business: buyer, pricing, free guests, growth loop, pilot results table (pilot vs sample rows), quote with permission
7. What's next

### 15.4 Pre-submit checklist
- [ ] Live URL works in an incognito window on desktop and on a phone on cellular data
- [ ] Pool depth ≥ 5. Smoke e2e green within the last hour.
- [ ] App Key on the form and in the PDF. **App Secret nowhere** (grep repo + bundle).
- [ ] Repo public, README complete, licence present, no secrets in history
- [ ] Video public/unlisted and playable logged-out
- [ ] Metrics screenshot dated. Pilot vs sample separated.
- [ ] Every claim in the write-up demonstrable in the live app

---

## 16. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Nexconn behaviour differs from assumptions (private subchannels, status messages, metadata events) | Med | High | Day-0 spike with documented fallbacks (§4.7) |
| Rate limits during seeding | Med | Med | Pre-warmed pool, token-bucket queue, retries |
| Subchannel cap per community | Low–Med | Med | Per-session community, cap judge-created pins at 10 |
| Judge uses one device only | High | Med | Second tab works (per-tab identity), role switcher, QR prominent |
| Same role opened in two places gets kicked | Med | Low | Kicked-offline modal with "use here" |
| Flaky network at judging | Med | High | Polling fallback, server-authoritative decisions, refresh-safe |
| PDF and app disagree | Low | High | Single `buildDecisionRecord`, record hash, e2e PDF text assertion |
| Pilot recruitment slips | High | Med | Start Day 1, low-ask 20-min sessions, report honestly even if small |
| SDK version churn (26.5.x just released) | Low | Med | Pin exact versions, lockfile committed |
| Scope creep | High | High | P0/P1/P2 tiers, cut lines on Day 6 and Day 8 |

---

## 17. Definition of done (maps to the spec's demo script)

1. **Propose the reroute.** MEP lead opens RFI-001, draws a dashed route on the crop, posts Proposal v1 with cost/schedule impact, approves for MEP. Both devices show **"In review · Waiting for Structural"** within 3 s.
2. **Follow the alert.** On the second device, Structural sees the Jump to pin alert, taps it, and lands on the same location on C-103 Rev B with the room open. Asks a free-text question. MEP sees it live and replies. A judge-typed question works the same way.
3. **Make the decision.** Structural taps **Approve proposal**. Both pins turn **green** with the label "Review complete." Opening the pin shows two named approvals with roles, times, v1, Rev B. Repeated clicks or a reconnect still show exactly one approval per reviewer.
4. **Hand it over.** Refresh both devices: identical state. Export the register: the PDF shows the same proposal, revision, reviewers, status, and record hash.
5. **Explore.** A fresh issue can be raised from a blank spot. RFI-002 shows waiting for review, RFI-003 completes the hold → evidence → clear → approve path, RFI-004 shows a completed review with a superseded version.
6. **Submit.** Live URL, public repo, video, and PDF write-up with App Key are all submitted, with pilot metrics reported separately from sample activity.

---

## Appendix A: Verified Nexconn references

- `@nexconn/chat` 26.5.1 / `@nexconn/engine` 26.5.1 (exact peer pin) / `@nexconn/chatui` 26.5.0 (Lit, ESM-only, peers `lit ^3.3.2`)
- `ChannelType.COMMUNITY = 10`. `CommunitySubChannelType.PUBLIC = 0`, `PRIVATE = 1`
- Built-in message types are `RC:TxtMsg`, `RC:ImgMsg`, `RC:FileMsg`, `RC:ReferenceMsg`, …. Custom types are registered with `{ messageType, isPersisted, isCounted, isStatusMessage? }`.
- `Message` exposes `messageId`, `senderUserId`, `sentTime`, `content`, `metadata: Map<string,string>`, `setMetadata()`, `addReaction()`
- `SendMessageParams` supports `directedUserIds`, `metadata`, `pushConfig`, `needReceipt`, `disableNotification`
- `sendTypingStatus` exists only on direct channels, so there is no community typing indicator
- Server: `nexconn-server-sdk-go` v0.1.2. Signing is `sha1(appSecret + nonce + timestamp)` hex with `App-Key`/`Nonce`/`Timestamp`/`Signature` headers. All endpoints are `POST /v4/...` JSON.
