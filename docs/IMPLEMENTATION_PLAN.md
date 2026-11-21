# PinThread: Implementation Plan for the Nexconn Build Challenge 2026

Companion to [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md). That document says *what* PinThread is. This one says *how we build it, in what order, and how each piece earns points*.

> **Sources.** The challenge facts come from the Reskilll challenge page (reskilll.com/hack/nexconn). Nexconn behaviour was verified on 2026-11-21 against docs.nexconn.ai, the published **`@nexconn/chat` 26.5.1 / `@nexconn/engine` 26.5.1** type definitions, and the OpenAPI spec bundled with **`nexconn-server-sdk-go` v0.1.2**. The few behaviours only a live test can settle are listed in §4.9 and covered by the first build phase.

---

## 0. Challenge facts that shape the plan

| Item | Confirmed detail |
| --- | --- |
| Requirement | "Chat SDK or Chat UI is required. Call SDK is optional." The app must use the Nexconn Chat SDK. |
| Track | **Workplace & Collaboration** ("Direct messaging and team project threads") is the natural fit. |
| Team | 1–4 people. The team leader selects the track and submits. |
| Deliverables | **Write-up PDF + App Key**, **demo video**, **runnable app link**, **public GitHub repo**. **Traction proof** is an optional bonus. |
| Judging | **50% Completeness & UX**: "It works from start to end and is easy to use." **30% Innovation & scenario value**: "A new idea that solves a real communication problem." **20% Business & growth potential**: "Real users on Nexconn and a path to a product." |
| Judging window | Judges use the live app after submissions close, so it must stay up and within plan limits throughout (§13.3). |
| Prizes | $5,000 across 5 winners. 1st place $2,000. |
| Nexconn plan | The **Free plan** includes community channels (Starter does not). It lasts **one month**, then the app is blocked until a paid plan is chosen. Limits: **2,000 MAU**, **peak concurrent connections at 5% of MAU (100)**, **500 MB** file storage and upload per month. Exceeding MAU or connections blocks new connections, and exceeding upload quota makes uploads fail. |

---

## 1. The winning thesis

1. **Half the score is "does it work, start to end, and is it easy?"** One flawless two-device moment beats ten features. The beam-clash flow must work every time with no sign-up and no coaching, and it must work on a phone: propose, alert, question, reply, approve, both pins green, refresh, PDF.
2. **Use Nexconn as the backbone, not a chat widget.** Map community → project, private subchannel → pin room, custom message types → structured RFI entries, server-set message metadata → live proposal cards, @mentions in discipline subchannels → "Jump to pin," and a public status subchannel → live pin colours. The write-up can then name a dozen distinct SDK-backed interactions.
3. **The server owns every decision. Nexconn delivers it.** Approvals are validated and stored in Postgres in one transaction, then published through an outbox. Repeated clicks, reconnects, and refreshes cannot create a second approval or a pin colour that disagrees with the record.
4. **Make the judge's path obvious.** Use a guided four-step tracker that ticks itself off, a QR code to bring in a phone, a fresh pre-warmed project per visitor, and a visible "Nexconn live" indicator.
5. **"Real users on Nexconn" is literally a criterion.** Measure it from Nexconn's own `user:connection_status` webhook so the traction numbers are authoritative, and keep pilot and demo activity strictly apart.

---

## 2. Judging criteria → what we build → what we show

| Criterion | What wins it | Built in | Evidence in submission |
| --- | --- | --- | --- |
| **Chat SDK required** (gate) | Client SDK and Platform Chat API both load-bearing. App Key on the form and in the PDF. Live exchange between two independently connected users. | §4 | "SDK-backed interactions" table (§15.3). Video shows two screens exchanging live. |
| **Completeness & UX, 50%** "works start to end, easy to use" | Judge opens the URL, sends a message, finishes the review, and retrieves a matching PDF record, on desktop and phone. No dead ends, fast, recoverable. | §7, §8, §10, §12 | 2-screen video, e2e GIF in README, live URL with pre-warmed sessions |
| **Innovation & scenario, 30%** "new idea, real communication problem" | Location + conversation + reviewers in one place. What the site lead sees while one review is outstanding, and what changes when it arrives. Versioned proposals with redlines, holds with evidence. | §5, §7.2–7.3 | Video beats 1–3. Write-up "why spatial threads." |
| **Business & growth, 20%** "real users on Nexconn, path to a product" | Webhook-verified pilot users, invite acceptance, issues completed, practitioner quote. Buyer, price, free guests, cross-firm invite loop, unit economics on Nexconn pricing. | §11 | Metrics export, pilot table, quote, economics table |
| **Traction proof** (optional bonus) | Pilot projects with outside reviewers who actually connected | §11 | `/admin/metrics` export filtered to `kind = pilot` |

---

## 3. Scope and priorities

### P0: demo-critical (never cut)
- Per-visitor demo project (Meridian Tower, Level 03, Rev B) seeded with 4 pins, people, question, field photo
- "Start as MEP lead," plus a second-device join via QR or link as the Structural engineer, each a distinct Nexconn user
- Drawing viewer: pan/zoom (mouse, trackpad, pinch), 3 toggleable layers (Arch/Struct/MEP), pins with **text status + colour + shape**
- Issue room per pin (private subchannel): history on open, text, photos, reply
- Pinned issue brief (crop, sheet revision, grid ref, question, required reviewers)
- Proposal with redline route drawn on the crop, cost/schedule impact, versions
- Sign-off card: approve / request change, names who responded and who we're waiting for
- Server-validated, idempotent approvals tied to the proposal version and drawing revision
- Live pin status on every connected device (Open → In review → Review complete; Blocked)
- "Jump to pin" alert in the discipline subchannel, with a deep link to the same location and revision on any device
- Refresh-safe: the drawing, thread, and register agree after a reload
- PDF register export
- Deployed public URL, public repo, README

### P1: score multipliers
- Hold / evidence / clear-hold exception path (slab pin)
- Raise a new RFI from a blank spot (choose reviewers, room auto-created, Jump alerts sent)
- Issue list with filters (discipline, severity, status)
- Guided demo tracker (4 steps, auto-ticks from real events)
- "Waiting on you" inbox
- Live-updating proposal card via Nexconn message metadata
- Nexconn activity drawer (shows SDK events live: great for video and write-up)
- Pilot mode: upload one sheet, invite links, webhook-backed metrics, feedback prompt
- Role switcher (single-device judges)

### P2: stretch
- Proposal diff overlay (v1 ghost route vs v2)
- Reactions ("seen") on cards (SDK 26.5.0 reactions)
- Handover "next shift" read-only summary
- Per-record QR codes in the PDF
- Message translation (`translateModule`) for multilingual crews

### Out of scope (name it as "next" in the write-up)
Multi-sheet sets, revision comparison, CSV export, presence indicators, SSO/accounts, native apps, BIM/IFC import.

---

## 4. Nexconn integration design

### 4.1 Architecture

```
 ┌──────────────── Browser (desktop / phone) ────────────────┐
 │ React SPA                                                  │
 │  ├─ Drawing viewer (SVG sheet, layers, pins, redlines)     │
 │  ├─ Issue room (custom React UI on @nexconn/chat)          │
 │  ├─ TanStack Query  ── REST ──────────────┐                │
 │  └─ NCEngine (WebSocket to Nexconn) ◄──┐  │                │
 └────────────────────────────────────────┼──┼────────────────┘
        live messages, history, uploads   │  │  decisions, state, tokens, PDF
                                          │  ▼
 ┌──────────────── Nexconn (SG data centre) ─┐   ┌──────── PinThread server (Node) ─────────┐
 │ Community   c<projectId>  = project       │   │ Hono API (zod-validated)                  │
 │  ├─ board        public, status messages  │◄──┤ Platform Chat API client (signed, v4)     │
 │  ├─ discmep / discstruct / discarch /     │   │ Outbox dispatcher (retry, dedupe)         │
 │  │  discsite     public, Jump alerts      │   │ Demo pool + seeder + cleanup              │
 │  └─ p<pinId>     private, one per pin     │──►│ Webhook receiver (user:connection_status) │
 └───────────────────────────────────────────┘   │ PDF renderer (react-pdf + resvg)          │
                                                 └───────────────┬───────────────────────────┘
                                                        ┌────────▼────────┐
                                                        │ Postgres (truth)│
                                                        └─────────────────┘
```

**Single source of truth.** Postgres owns pins, proposals, sign-offs, holds, evidence, and status. Nexconn holds the conversation and carries real-time signals. Structured messages are **signals, not truth**. When a client receives `pt:decision`, `pt:pinstate`, or a metadata change, it checks the sender and `seq` and refetches the pin from the API. Every state change is one DB transaction that also writes outbox rows. The dispatcher publishes after commit and retries, so if Nexconn blips the record is still right and clients converge on reconnect or refresh.

### 4.2 Mapping and identifiers (rules verified in docs)

| PinThread | Nexconn | ID format | Created by |
| --- | --- | --- | --- |
| Project | Community channel | `c` + 10 alnum, e.g. `c7f3k9q2mzx`. Letters/digits, ≤ 64 | `POST /v4/community-channel/create` with `userId` = the project's site lead |
| Live pin status feed | Public subchannel | `board` | `POST /v4/community-channel/subchannel/create`, `channelVisibility: 0` |
| Discipline inboxes | Public subchannels | `discmep`, `discstruct`, `discarch`, `discsite` | same |
| Issue room (per pin) | **Private** subchannel | `p` + 10 alnum. **Letters/digits only, ≤ 20** | create with `channelVisibility: 1`, then `POST /v4/community-channel/private-subchannel/member/add` |
| Participant | User | `u` + projectId + role code, e.g. `uc7f3k9q2mzxmep` | `POST /v4/auth/access-token/issue`, then `POST /v4/community-channel/join` (one user per call) |
| System actor | User `ptbot` (**never joins communities**) | — | Registered once. Sends as a **non-member** (allowed by the send API). |

Rules that drove these choices:
- **No underscores or hyphens** in community or subchannel IDs: letters and digits only.
- **50 subchannels per community.** A demo uses 5 fixed + 4 seeded rooms, so cap judge-created pins at 20 per project.
- **Each user can join at most 100 communities.** A shared bot member would break after 100 demo sessions, so the bot sends as a non-member and each project's site lead is the community creator.
- **Private subchannel members must already be community members** (error `24406` otherwise), at most 20 IDs per request. Order: create community → join users → create subchannel → add members → send.
- Never use the default subchannel (`RCDefault`/`NCDefault`), which behaves differently.
- Public subchannels deliver to all community members without joining, so `board` and `disc*` reach everyone.
- A non-member sending to a private subchannel fails silently on the server. Keep the member list in our DB and disable the composer for non-members.

### 4.3 Platform Chat API client

- **Base URL (Singapore):** `api.sg-light-api.com` (primary), `api-b.sg-light-api.com` (backup). NA (`api.us-light-api.com`) and Saudi (`api.sau-light-api.com`) also exist. Server domain and client `AreaCode` must match the app's data centre.
- **Requests:** `POST`, `application/json`, HTTPS only.
- **Headers:**
  - `App-Key`
  - `Nonce`: a random string of **at most 18 characters**, new for each request
  - `Timestamp`: milliseconds
  - `Signature`: `sha1(appSecret + nonce + timestamp)` as hex
- **Success:** HTTP 200 with `{"code":0}`. Anything else is an error, and HTTP 429 means rate-limited.
- **Failover:** switch to the backup domain on a 5 s timeout or an unexpected status. Don't hold keep-alive connections longer than **55 s idle or 80 reuses**.

```ts
// apps/server/src/nexconn/client.ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Agent } from 'undici';

const agent = new Agent({ keepAliveTimeout: 50_000, keepAliveMaxTimeout: 50_000, connections: 16 });

export class NexconnServer {
  private domainIdx = 0;
  constructor(private cfg: { appKey: string; appSecret: string; domains: [string, string] }) {}

  async post<T>(path: string, body: unknown, attempt = 0): Promise<T> {
    const nonce = randomBytes(9).toString('hex');                    // 18 chars (docs: ≤ 18)
    const timestamp = String(Date.now());
    const signature = createHash('sha1').update(this.cfg.appSecret + nonce + timestamp).digest('hex');
    try {
      const res = await fetch(`https://${this.cfg.domains[this.domainIdx]}${path}`, {
        method: 'POST', dispatcher: agent, signal: AbortSignal.timeout(5_000),
        headers: { 'Content-Type': 'application/json', 'App-Key': this.cfg.appKey,
                   Nonce: nonce, Timestamp: timestamp, Signature: signature, 'X-Request-ID': randomUUID() },
        body: JSON.stringify(body),
      } as RequestInit);
      if (res.status === 429 && attempt < 4) { await sleep(300 * 2 ** attempt); return this.post(path, body, attempt + 1); }
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.code !== 0) throw new NexconnError(path, res.status, json);   // business error: do not fail over
      return json as T;
    } catch (e) {
      if (e instanceof NexconnError || attempt >= 2) throw e;
      this.domainIdx = 1 - this.domainIdx;                                    // primary ⇄ backup
      return this.post(path, body, attempt + 1);
    }
  }
}
```

Wrap it in a token-bucket queue: 80 req/s global and **≤ 15 msg/s per subchannel**. The send limit is 100/s overall and 20/s per subchannel.

### 4.4 Server API calls we use

| When | Endpoint | Limit | Key fields |
| --- | --- | --- | --- |
| Issue a user token | `/v4/auth/access-token/issue` | 200/s | `userId`, `name`, `avatarUrl` → `result.accessToken`. Cache it, and never put it in a URL or log. |
| Create project | `/v4/community-channel/create` | 100/s | `userId` (site lead), `channelId`, `name` |
| Add a person | `/v4/community-channel/join` | 100/s | `channelId`, `userId` |
| Create rooms | `/v4/community-channel/subchannel/create` | 100/s | `channelId`, `subchannelId`, `channelVisibility` |
| Restrict a pin room | `/v4/community-channel/private-subchannel/member/add` | 100/s | `userIds` (≤ 20, must be members) |
| Post structured cards and seed messages | `/v4/community-channel/message/send` | 100/s, 20/s per subchannel | `fromUserId`, `toChannelIds:[c]`, `subchannelId`, `messageType`, `content` (**custom ≤ 10 KB**), `pushContent`, `shouldPersist`, `isCounted`, `hasMention`, `hasMetadata`, `metadata`, `toUserIds` |
| Update a proposal card in place | `/v4/community-channel/message/metadata/set` | 100/s | `messageId`, `metadata`. Keys ≤ 32 chars, values ≤ 4096, ≤ 100 pairs per request, ≤ 300 per message. |
| Audit a thread (admin only) | `/v4/community-channel/history-message/list` | **100/min** | 14-day window |
| Expire demos | `/v4/community-channel/dismiss` | 100/s | `channelId` |
| Traction metrics | **Webhook** `user:connection_status` | — | `status "0"` = connected, with `userId`, `os`, `time`, `sessionId` |

The sender's own client **does receive** a server-sent community message while online, and it is stored in the sender's history. Our client dedupes by domain ID, not message ID.

### 4.5 Client SDK usage (names checked against `@nexconn/chat` 26.5.1)

```ts
// apps/web/src/nexconn/engine.ts
import {
  NCEngine, AreaCode, LogLevel, MessageHandler, ConnectionStatusHandler, ConnectionStatus,
  CommunitySubChannel, BaseChannel, SendTextMessageParams, Helper,
} from '@nexconn/chat';
import { PT_MESSAGE_REGISTRATIONS } from '@pinthread/shared';

let started = false;
export async function startEngine(token: string) {
  if (started) return; started = true;                                  // docs: connect once per app lifecycle
  NCEngine.initialize({ appKey: import.meta.env.VITE_NEXCONN_APP_KEY, areaCode: AreaCode.SG, logLevel: LogLevel.WARN });
  NCEngine.registerCustomMessages(PT_MESSAGE_REGISTRATIONS);            // docs: must precede connect
  NCEngine.addConnectionStatusHandler('pt', new ConnectionStatusHandler({
    onConnectionStatusChanged: ({ status, code }) => {
      if (status === ConnectionStatus.DISCONNECTED && code === 31010) return kickedElsewhere(); // no auto-reconnect after a kick
      connectionStore.set(status);                                      // SDK retries every 5 s; drives "Nexconn live" chip
      if (status === ConnectionStatus.CONNECTED) resyncAfterReconnect(); // community has no missed-message compensation
    },
  }));
  NCEngine.addMessageHandler('pt', new MessageHandler({
    onMessageReceived: ({ messages }) => messages.forEach(routeIncoming),              // route by subChannelId
    onCommunityChannelMessageMetadataChanged: ({ messages }) => messages.forEach(onMetadataSignal),
  }));
  const res = await NCEngine.connect({ token });
  if (!res.isOk) throw new ConnectError(res.code);
}

export const roomHistory = (c: string, s: string) => BaseChannel.createMessagesQuery({
  channelIdentifier: new CommunitySubChannel(c, s).identifier, startTime: Date.now(), pageSize: 30, isAscending: false,
});                                                                       // .loadNextPage() while .hasNext

export const sendText = (c: string, s: string, text: string) =>
  new CommunitySubChannel(c, s).sendMessage(new SendTextMessageParams({ text }));

export async function sendPhoto(c: string, s: string, file: File, onProgress: (p: number) => void) {
  const r = await Helper.createSendImageMessageParams(await compress(file));   // ≤ 1.5 MB: Free plan has 500 MB/month upload
  if (!r.isOk) throw new Error(String(r.code));
  r.data.onUploadProgress = onProgress;
  return new CommunitySubChannel(c, s).sendMediaMessage(r.data);
}
```

Client-SDK interactions to name in the write-up:
1. `NCEngine.initialize` + `connect` with a server-issued token (one identity per role, per tab)
2. `registerCustomMessages` for 8 PinThread types
3. `MessageHandler.onMessageReceived`, routed by community subchannel
4. Remote room history: `BaseChannel.createMessagesQuery(...).loadNextPage()`
5. Text, replies (`SendReferenceMessageParams`), field photos (`Helper.createSendImageMessageParams` + `sendMediaMessage` with upload progress)
6. Live card updates: `onCommunityChannelMessageMetadataChanged`
7. Unread badges on pins: `CommunitySubChannel.reload()` → `unreadCount`. Clear on open with `clearUnreadCount()`.
8. Connection status, auto-reconnect, and kick handling (`31010`)
9. (P2) Reactions: `message.addReaction`

### 4.6 PinThread message contracts (`packages/shared/src/messages.ts`)

Custom types must be ≤ 32 characters and must not start with `RC:`/`NC:`. Content is **≤ 10 KB**: cards carry IDs, a short display snapshot, and at most 64 route points with 4-decimal precision. Full detail comes from the API.

| `messageType` | Registration | Sender | Subchannel | Purpose |
| --- | --- | --- | --- | --- |
| `pt:brief` | persisted, not counted | `ptbot` | `p*` | Pinned issue brief |
| `pt:evidence` | persisted, counted | actor | `p*` | Field evidence card (photo, author, time, optional `holdId`) |
| `pt:proposal` | persisted, counted | actor | `p*` | Proposal vN, with **metadata** for live status |
| `pt:signoff` | persisted, counted | actor | `p*` | Approve / request change on vN at Rev B |
| `pt:hold` | persisted, counted | actor | `p*` | Hold placed / evidence added / cleared |
| `pt:decision` | persisted, not counted | `ptbot` | `p*` | Status transition record |
| `pt:jump` | persisted, counted | `ptbot` | `disc*` | "Jump to pin" with deep link + `mentionedInfo` (`type: 2`, `userIdList`) and `hasMention: 1` |
| `pt:pinstate` | **`isStatusMessage: true`**, not persisted, not counted | `ptbot` | `board` | Live pin colour/label. Sent with `shouldPersist: 0, isCounted: 0`. |

The registration field is `isPersisted` in the TypeScript types (the docs page spells it `isPersited`; the compiler is authoritative).

```ts
type PTBase = { v: 1; projectId: string; pinId: string; seq: number };   // seq = pins.state_seq after this change
export type ProposalMsg = PTBase & {
  proposalId: string; version: number; revision: string;
  summary: string;                                       // ≤ 280 chars, full text via API
  route: Array<[number, number]>;                        // ≤ 64 normalized points
  costImpact?: string; scheduleImpact?: string; supersedesVersion?: number;
  author: { userId: string; name: string; role: Role };
};
export type SignoffMsg = PTBase & {
  signoffId: string; proposalId: string; version: number; revision: string;
  verdict: 'approve' | 'request_change'; comment?: string; reviewer: { userId: string; name: string; role: Role };
};
export type DecisionMsg = PTBase & {
  decisionId: string; status: PinStatus; label: string;
  waitingFor: Array<{ userId: string; name: string; role: Role }>;
  approvals: Array<{ name: string; role: Role; at: string; version: number; revision: string }>;
};
export type PinStateMsg = { v: 1; projectId: string; pinId: string; seq: number; status: PinStatus; label: string };
```

**Proposal card metadata** is set at send (`hasMetadata: true`) and updated with `metadata/set`:
- `st`: `current`, `superseded`, or `accepted`
- `ap_<role>`: approval time
- `rc_<role>`: change-request time

Clients *can* also call `message.setMetadata`. Treat every metadata change as a **signal to refetch the pin**, and render approvals from API data. The card still updates live, and nobody can forge an approval.

### 4.7 Delivery semantics

| Concern | Rule |
| --- | --- |
| Duplicate cards | Key cards by domain ID (`signoffId`, `decisionId`). The outbox `dedupe_key UNIQUE` publishes each domain event once. |
| Echo to the actor | Confirmed: the actor's client receives its own server-sent card. The UI updates from the HTTP response first and dedupes the echo. |
| Out-of-order status | Ignore `seq <= lastSeenSeq[pinId]` |
| Reconnect | Community channels have **no missed-message compensation**. On `CONNECTED` after a drop, refetch project state and reload the open room's newest page, merging by message ID. |
| Nexconn unavailable | If not connected for more than 5 s, poll `GET /api/projects/:id/state` every 5 s and show "Reconnecting…". Decisions still work because they go through our API. |
| Forged messages | Render `pt:brief`/`pt:decision`/`pt:jump`/`pt:pinstate` only from `ptbot`, and other `pt:*` only from room members. Pin colour always comes from the API. |
| Same role opened twice | `DISCONNECTED` + `31010`: show "This role is open on another device. Use it here?" and re-`connect` on confirm. Because identity is per tab, two different roles in two tabs never collide. |
| History retention | Community cloud retention is **7 days by default**. The decision record lives in Postgres, so the PDF and pin history never depend on it. |

### 4.8 Console settings checklist

| Setting (Console → Chat → Chat settings) | Value | Why |
| --- | --- | --- |
| Data centre | Singapore (`AreaCode.SG`, `api.sg-light-api.com`) | SDK default. Must match client and server. |
| Community Channels → Restrict message access to members | **On** | Pin rooms stay private |
| Community Channels → Enable pre-join history access by new member | **On** | A reviewer invited later sees the earlier conversation |
| Community Channels → cloud retention | On (7 days) | Room history on reopen |
| Multi Devices → Message synchronization | On (default) | Same user on laptop + phone |
| Webhooks → URL `https://<app>/api/nexconn/webhook`, event `user:connection_status` | On | Authoritative "real users on Nexconn" metric |
| Moderation for server-API messages | Off (default) | Bot cards are trusted |
| Plan | Free. **Check the expiry date** shown in the console. | Free is valid for one month. The app must stay live through judging. |

The Nexconn **AI skills** (`npx skills add https://github.com/NexconnAI-Dev/nexconn-skills.git`, skill `nexconn-chat`) and the **nexconn-console MCP server** can be installed for the coding agent. They speed up SDK work and let the agent check console settings like those above.

### 4.9 What only a live test can settle (Phase 1 walking skeleton)

Two tabs (two users) in a private subchannel exchange text. The server posts a `pt:proposal` with metadata, updates it, sends a `pt:pinstate` status message to `board`, and a `pt:jump` with a mention to `discstruct`. Then both tabs refresh.

| Check | Fallback if it fails |
| --- | --- |
| Live delivery for every accessible subchannel without "opening" it | Load the open room on demand. Use API polling for pin colours. |
| Server-set metadata fires `onCommunityChannelMessageMetadataChanged` on other clients | Refresh the proposal card on `pt:decision` |
| Server-sent **status** message (`shouldPersist: 0`) reaches online members | Persisted `pt:pinstate` with `isCounted: 0` |
| Custom `content` arrives as a parsed object in live and history results | Decode JSON strings defensively |
| `ptbot` (non-member) messages render with its name | Make the per-project site lead the sender of system cards |
| Mention in a custom type raises the mention flag | Inbox comes from the API anyway (§7.4) |
| Token lifetime | Re-issue on connect error and retry once |

Commit it as `spikes/walking-skeleton`. Record results in `docs/nexconn-notes.md`.

---

## 5. Domain model and rules

### 5.1 Postgres schema (Drizzle, abbreviated)

```sql
projects        (id pk, kind 'demo'|'pilot', name, community_id unique, claimed_at, created_at, expires_at)
users           (id pk, project_id fk, nexconn_user_id unique, display_name, role, firm, avatar_url,
                 nexconn_token, can_hold bool, first_connected_at)
sheets          (id pk, project_id fk, number 'C-103', title 'Level 03 Coordination Plan')
sheet_revisions (id pk, sheet_id fk, rev 'B', kind 'svg'|'raster', asset_id, width, height, issued_at, is_current)
pins            (id pk, project_id fk, sheet_revision_id fk, x real, y real,   -- normalized 0..1
                 grid_ref, title, question, discipline, severity, subchannel_id unique,
                 status, status_label, state_seq int, current_proposal_id, created_by, created_at)
pin_members     (pin_id, user_id, role, required_reviewer bool, primary key (pin_id, user_id))
proposals       (id pk, pin_id fk, version int, author_id, summary, route jsonb, cost_impact,
                 schedule_impact, sheet_revision_id, nexconn_message_id, created_at, unique (pin_id, version))
signoffs        (id pk, pin_id, proposal_id fk, sheet_revision_id, reviewer_id, verdict, comment,
                 created_at, updated_at, unique (proposal_id, reviewer_id, sheet_revision_id))
holds           (id pk, pin_id, placed_by, reason, clear_condition, status 'active'|'cleared',
                 cleared_by, cleared_at, created_at)
evidence        (id pk, pin_id, hold_id null, author_id, image_url, caption, nexconn_message_id unique null, created_at)
events          (id pk, pin_id, project_id, type, actor_id, payload jsonb, created_at)    -- append-only audit
outbox          (id pk, dedupe_key unique, kind, payload jsonb, attempts, next_attempt_at, sent_at,
                 nexconn_message_id, last_error)
idempotency     (key pk, user_id, response jsonb, created_at)
invites         (id pk, project_id, role, display_name, token_hash, accepted_at)
assets          (id pk, mime, bytes bytea, created_at)                  -- pilot sheet uploads
nexconn_presence(id pk, user_id, status, os, session_id, at)           -- from the connection-status webhook
analytics       (id pk, project_kind, project_id, user_id, name, props jsonb, at)
```

### 5.2 Pin status: one pure function, shared by client and server

```ts
// packages/shared/src/derivePinState.ts
export function derivePinState(f: PinFacts): PinState {
  if (f.activeHold) return {
    status: 'blocked', label: `Blocked · Hold by ${f.activeHold.placedByRole}`,
    waitingFor: f.activeHold.evidenceSubmitted ? [f.activeHold.placedBy] : [f.siteLead],
    outstanding: f.activeHold.evidenceSubmitted ? 'Assess evidence and clear hold' : f.activeHold.clearCondition,
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
| Reviewer approves the **current** version on the **current** revision | Leaves the waiting list. The last approval turns the pin `Review complete` (green). |
| Change requested | Stays `In review`. The card shows "Change requested by Structural." |
| New proposal version | Old approvals stay visible on the old card (`st=superseded`). The new version needs fresh approvals. |
| Hold placed | `Blocked` (takes precedence). The holder's approval on the current version is withdrawn, as a recorded event. |
| Evidence added | Still `Blocked`. Outstanding: "Structural to assess evidence." |
| Hold cleared | Back to `In review`, or `Review complete` if all approvals still stand |

A table-driven Vitest suite covers every row plus: stale version, revision mismatch, duplicate approval, non-required reviewer, and a hold placed on a complete pin.

### 5.3 Authorization matrix

| Action | Site lead | Required reviewer | Other room member | Notes |
| --- | --- | --- | --- | --- |
| Raise RFI, choose reviewers | ✓ | — | — | Demo: MEP lead may also raise |
| Post text/photo | ✓ | ✓ | ✓ | Client SDK. Composer disabled for non-members. |
| Post proposal / new version | — | ✓ | — | |
| Approve / request change | — | ✓ (own role only) | — | Must match the displayed `proposalId` + `revision`, otherwise 409 |
| Place hold | — | ✓ if `can_hold` (Structural, Architect) | — | |
| Add corrective evidence | ✓ | ✓ | — | |
| Clear hold | — | Hold author's role | — | |
| Export register | ✓ | ✓ | ✓ | |

### 5.4 Idempotency (the "repeated click" guarantee)

1. The client generates the `Idempotency-Key` **when the sign-off card renders**, so double-clicks send the same key. The button disables on the first click.
2. `BEGIN; SELECT … FROM pins WHERE id=$1 FOR UPDATE;` then validate the role, `proposalId == current_proposal_id`, and the current revision.
3. `INSERT INTO signoffs … ON CONFLICT (proposal_id, reviewer_id, sheet_revision_id) DO UPDATE SET verdict = EXCLUDED.verdict WHERE signoffs.verdict <> EXCLUDED.verdict`
4. Recompute `derivePinState`, bump `state_seq` only if the state changed, write `events` + `outbox`, store the idempotency response, then `COMMIT`.
5. A replayed key returns the stored response.
6. An e2e test fires 5 parallel approvals and asserts exactly 1 row and 1 `pt:signoff` card.

---

## 6. HTTP API (JSON, zod-validated, `Authorization: Bearer <session JWT>`)

| Method & path | Purpose |
| --- | --- |
| `POST /api/demo/sessions` `{role}` | Claim a pre-warmed project. Returns `{session, me, nexconnToken, projectId, joinLinks}`. |
| `POST /api/demo/join` `{projectId, role, sig}` | Second device/tab joins as another role (HMAC-signed, 24 h expiry) |
| `POST /api/demo/switch-role` `{role}` | Single-device role switch (P1) |
| `GET /api/me` | Identity + cached Nexconn token |
| `GET /api/projects/:id/state` | Sheet, revision, members, all pins with derived state and `seq` |
| `GET /api/pins/:id` | Full record: brief, proposals, sign-offs, holds, evidence, `waitingFor`, `outstanding`, record hash |
| `POST /api/projects/:id/pins` | Raise RFI. Creates the subchannel, adds members, posts the brief, sends Jump alerts. |
| `POST /api/pins/:id/proposals` | New version `{summary, route, costImpact, scheduleImpact, basedOnVersion}` |
| `POST /api/pins/:id/signoffs` | `{proposalId, revision, verdict, comment}` + `Idempotency-Key` |
| `POST /api/pins/:id/holds`, `POST /api/holds/:id/evidence`, `POST /api/holds/:id/clear` | Exception path |
| `POST /api/pins/:id/nudge` | Re-send `pt:jump` to whoever is outstanding (rate-limited) |
| `GET /api/projects/:id/register.pdf` | Register |
| `POST /api/pilot/projects`, `POST /api/pilot/projects/:id/invites` | Pilot mode (access-code gated) |
| `POST /api/nexconn/webhook` | `user:connection_status` receiver (signature-verified) |
| `GET /api/admin/metrics` | Pilot vs demo metrics (admin key) |
| `GET /healthz`, `GET /status` | Liveness. Nexconn reachability, pool depth, MAU/connection headroom. |

---

## 7. Frontend

### 7.1 Routes and identity

| Route | Screen |
| --- | --- |
| `/` | Landing: one-line pitch, **Start as MEP lead** (primary), Start as Site lead, 4-step preview, "Built on Nexconn Chat" |
| `/p/:projectId?pin=:pinId&rev=B` | Workspace: drawing + room/list |
| `/j/:projectId/:role?sig=…` | Join as another role (second device). Shows who you will be, then **Join**. |
| `/pilot/new`, `/i/:inviteToken` | Pilot creation, invite acceptance |
| `/admin/metrics` | Metrics |

**Identity per tab.** The session JWT and Nexconn token live in `sessionStorage`. Two tabs can be MEP and Structural, and a refresh keeps the identity. Join links carry only a signed invite, never a Nexconn token.

### 7.2 Drawing viewer
- **Sheet asset:** an original SVG of *Meridian Tower, C-103 Level 03 Coordination Plan, Rev B*, generated by `assets/meridian/build-sheet.ts`:
  - Grid A–H × 1–9 with bubbles, columns, beams with marks (B-14 between C/4 and D/4), walls and cores
  - Supply duct runs, electrical riser ER-2, slab pour zone 3B, curtain wall along grid A
  - Title block with revision table
  - Layers are `<g id="layer-arch|struct|mep">` so toggles flip `display`
- **Pan/zoom:** `react-zoom-pan-pinch` with double-tap zoom and "Fit sheet" / "Zoom to pin." Pins sit in a counter-scaled overlay, so they stay finger-sized at every zoom.
- **Coordinates:** pins are stored normalized to `[0,1]` of the sheet viewBox. `?pin=` calls `zoomToElement`, so desktop and phone show the same spot.
- **Pin visual** (colour + shape + text):
  - Open: blue circle, "Open"
  - In review: amber half-circle, "In review · Waiting for Structural"
  - Blocked: red octagon, "Blocked"
  - Review complete: green circle with check, "Review complete"
  - Unread badge from the subchannel `unreadCount`. Pulse on state change.
- **Crop:** an SVG `<use>` of the same sheet with a tight viewBox (≈ 12% of sheet width). The server renders the identical crop with resvg for the PDF.
- **Redline tool:**
  - Tap to add points, drag to move, double-tap or Enter to finish, undo
  - Dashed magenta with arrowheads
  - Stored as ≤ 64 normalized points
- **Raise RFI:** long-press (mobile) or "+ New issue" then click → panel with title, question, discipline, severity, reviewer chips, optional photo. The pin appears optimistically with "Setting up room…".

### 7.3 Issue room
Desktop: right panel at 420 px. Mobile: a **bottom sheet** (peek / half / full) so the drawing stays visible.

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
├ Sign-off bar (only for required reviewers) ────────────────┤
│ Reviewing Proposal v1 on Rev B  [Request change] [Approve] │
├ Composer ──────────────────────────────────────────────────┤
│ [📷] [＋ Proposal] [⛔ Hold] [ Message…            ] [Send] │
└────────────────────────────────────────────────────────────┘
```

- **Card renderers:** one per `messageType`. Unknown types fall back to a placeholder.
- **Sign-off bar:** always names the version and revision it will approve. A 409 shows "Proposal changed to v2. Review the new route" and scrolls to it.
- **Sending:** optimistic text with retry. Image upload progress comes from `onUploadProgress`. Replies quote via reference messages.
- **Unread:** cleared on open.
- **States:** empty, loading, error, and offline states everywhere.

### 7.4 Issue list and "Waiting on you"
- **Issue list:**
  - Status counts at the top
  - Filter chips: Discipline (Arch/Struct/MEP/Elec), Severity, Status
  - Sort by "waiting longest"
  - Tap → zoom to pin
- **"Waiting on you"** is computed from the API: pins where I'm in `waitingFor`. It is highlighted live when a `pt:jump` mentioning me arrives, with a toast offering "Jump to pin." The Web SDK has no unread-message list for community subchannels, so the API is the reliable source.

### 7.5 Guided demo tracker (P1)
A compact checklist at the top left:
1. **Propose the reroute.** Ticks on your `pt:proposal` plus the MEP approval.
2. **Bring in Structural on another device.** Shows a QR code. Ticks when the webhook reports the Structural user connected.
3. **Structural approves.** Ticks on `Review complete`.
4. **Refresh and export the register.** Ticks on the PDF download.

Each step has a "Show me" link and emits analytics events, which measure demo completion.

### 7.6 Invite panel and activity drawer
- **Invite panel:** a large QR code for `/j/:projectId/struct?sig=…`, a copy-link button, and "Open in new tab." Text: "Open this on your phone to act as Dana Okafor, Structural engineer."
- **Nexconn activity drawer (P1):** a live log of SDK events, for example `connected as uc…struct`, `onMessageReceived pt:proposal in p…`, `metadata changed ap_struct`, `pt:pinstate seq 7 → complete`. It makes the SDK visible to judges.

### 7.7 Quality bar
- First load ≤ 2.5 s on 4G. Lazy-load the SDK after the drawing paints and code-split the PDF link.
- Touch targets ≥ 44 px. Usable at 360 px wide. No horizontal scroll.
- WCAG AA contrast. Status never shown by colour alone. Keyboard-operable on desktop.

---

## 8. Demo session system

- **Pool:** a worker keeps **5** seeded projects ready. Seeding takes about 25 Nexconn calls, so it never happens on a judge's click. A claim is atomic: `UPDATE … SET claimed_at = now() WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`. If the pool is empty, seed synchronously behind a progress screen.
- **Seeding order:**
  1. Issue tokens
  2. Create the community (site lead as creator)
  3. Join the other users
  4. Create `board` + `disc*` + 4 `p*` rooms
  5. Add private members
  6. Send briefs, the field photo (`RC:ImgMsg` with a ≤ 10 KB base64 thumbnail + `imageUri`), and seeded proposals, sign-offs, and holds
  7. Set metadata
- **Identities:** each project has its own users (`…site`, `…mep`, `…struct`, `…arch`). Two devices are two independently connected Nexconn users.
- **Plan headroom:**
  - MAU counts only users who *connect*, and pool users don't, so each demo costs 1–3 MAU.
  - Free allows 2,000 MAU and 100 concurrent connections. Cap demo claims per day (e.g. 300) so pilots always have room.
  - `/status` shows the remaining headroom.
- **TTL:** demo projects expire after 48 h. An hourly cleanup dismisses each expired community and deletes its rows. Claims are rate-limited per IP.
- **Reset:** "Start over" claims a fresh project.

## 9. Seed content: Meridian Tower, Level 03, Rev B

| Role | Name (fictional) | Firm | Notes |
| --- | --- | --- | --- |
| Site lead | Priya Shah | Halden Construction | Raises RFIs, exports register, community creator |
| MEP lead | Marco Ruiz | Northline MEP | Default demo role |
| Structural engineer | Dana Okafor | Okafor Structural | Second-device role, `can_hold` |
| Architect | Lena Park | Park & Vale Architects | `can_hold` |

| # | Title | Grid | Discipline / severity | Required reviewers | Seeded state |
| --- | --- | --- | --- | --- | --- |
| RFI-001 | Supply duct SD-3 crosses Beam B-14 | C–D/4 | MEP / High | MEP, Structural | **Open**: question + field photo. *Hero.* |
| RFI-002 | Electrical riser ER-2 penetration through core wall | E/7 | Elec / Medium | Architect, MEP | **In review**: v1 by MEP, MEP approved, waiting for Architect |
| RFI-003 | Slab pour 3B: honeycombing at edge | F–G/2–3 | Struct / High | Structural, Architect | **Blocked**: Structural hold "Core test results or repair method statement required" |
| RFI-004 | Curtain wall bracket spacing at grid A | A/1–3 | Arch / Low | Architect, Structural | **Review complete**: v2 approved by both, v1 superseded |

All images and drawings are original. Chat bubbles from seeding read "just now." Brief and evidence cards show the backdated domain times from the DB.

## 10. PDF register

- **Endpoint:** `GET /api/projects/:id/register.pdf`, rendered by `@react-pdf/renderer`.
- **Single builder:** `buildDecisionRecord(pinId)` feeds the pin API, the decision cards, and the PDF, so the drawing, thread, and register agree.
- **Cover:** project, sheet, revision, exported by, export time, counts by status.
- **One section per pin:**
  - RFI number, title, status label (text)
  - Crop PNG with pin + redline, rendered by resvg from the same SVG
  - Sheet, revision, grid, discipline, severity, and the question
  - **Accepted proposal** (version, summary, cost/schedule). Incomplete pins show the current proposal marked "Not yet accepted."
  - **Sign-offs:** name, role, firm, verdict, time, version, revision. Approvals on superseded versions are listed as history.
  - Holds: reason, clear condition, evidence, cleared by/at
  - **Outstanding action**, e.g. "Waiting for Dana Okafor (Structural) to approve v1"
  - **Record hash** (8 chars of sha256 over the decision record). The same hash shows in the app's pin panel.
- **Test:** the e2e suite parses the PDF text and asserts it matches the API.

## 11. Pilot mode, traction, and business

### 11.1 Product features (P1)
- **Create a pilot project** (access code): name, **one sheet** (PNG/JPG, or a PDF page rasterised in the browser with pdf.js), revision label. The viewer supports raster sheets with layers hidden.
- **Invite links** per person (role + name): signed, single-use, no account. **Guests are free.** Shared by WhatsApp or email.
- **Feedback prompt** after Review complete: "What was confusing?" and "Can we quote you?" (explicit consent).
- **Metrics** (`/admin/metrics`), always split by `project.kind`:
  - **Participants active on Nexconn**: distinct `userId` with a `user:connection_status` `"0"` event from the **Nexconn webhook**, i.e. Nexconn's own record of real connections
  - Invitations sent / accepted (accepted = webhook-confirmed connection)
  - Issues raised / completed, median time to complete, second issue opened voluntarily
  - Demo sessions started / tracker step 4 reached

### 11.2 Pilot playbook (start recruiting at the same time as Phase 1)
1. **Recruit** 5–8 site coordinators and consultants (personal network, local contractors, construction communities, alumni). The ask: "Resolve one real drawing question with a consultant using a free tool, 20 minutes."
2. **Run:** the coordinator uploads a sheet, drops a pin, and invites the consultant. **No coaching.** Observe over a call, with consent.
3. **Record** using `docs/pilot/observation-template.md`:
   - Did the consultant follow the invite?
   - Did both complete without coaching?
   - Was a second issue opened voluntarily?
   - Could the next person on shift find the accepted route and name its reviewers?
   - What they did, one point of confusion, and the change we shipped in response (with commit)
4. **Report honestly:** pilot rows and sample/demo rows separately. Quote only with written permission.

### 11.3 Path to a product (write-up)
- **Buyer:** the project manager who chases answers across firms.
- **Price to test:** **$49 per project per month**. **Guest reviews free**, so a subcontractor can answer one question without a purchasing decision.
- **Growth loop:** every RFI brings outside reviewers from other firms into a real problem. Their firms run their own projects.
- **Unit economics on Nexconn** (published pricing; community channels require Free or Pro, not Starter):

| Item | Estimate |
| --- | --- |
| Nexconn Pro, 2k MAU tier | $360 / month |
| Active users per project (staff + guests) | ~15 MAU |
| Projects supported by the 2k tier | ~130 |
| Revenue at 130 projects × $49 | ~$6,370 MRR, so chat infrastructure is ~6% of revenue |
| Break-even on chat infrastructure | ~8 paying projects |
| Overage beyond tier | $0.12 / MAU |

- **Next:** multi-sheet sets, revision comparison that flags decisions for re-review while keeping earlier approvals on the drawing they were given against, CSV export, presence.

---

## 12. Testing strategy

| Layer | What | Tooling |
| --- | --- | --- |
| Unit | `derivePinState` table, authorization matrix, message-contract round-trips + **10 KB size guard**, signature function, ID validators (letters/digits, length) | Vitest |
| Integration | API services on real Postgres with a `FakeChatGateway`. Idempotency (5 parallel approvals → 1 row, 1 outbox row), stale version → 409, hold precedence, seeding call order. | Vitest |
| Contract (`@live`) | Real Nexconn calls: token, community, join, subchannels, private members, send, metadata, status message | Vitest, nightly |
| **E2E hero flow** | Two Playwright contexts (desktop 1440×900 + iPhone emulation) on staging/prod with real Nexconn: MEP proposes + approves → both "Waiting for Structural" → Structural opens the jump link and asks → MEP sees it and replies → Structural approves → **both pins green ≤ 3 s** → reload both → still green → PDF text matches | Playwright (`--trace off`) |
| E2E slab flow | Evidence → clear hold → approvals → complete | Playwright |
| E2E resilience | Approve while offline then reconnect → single approval. Double-click → single card. Kicked tab (`31010`) → modal. | Playwright |
| Visual | Pins and cards at 360 px and 1440 px | Playwright screenshots |
| Prod smoke | Scheduled GitHub Action runs the hero flow every 30 min while judging is open and alerts on failure. It uses 2 fixed users to avoid burning MAU. | Actions |

---

## 13. Deployment and operations

### 13.1 Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, Node 22, pnpm workspaces (`apps/web`, `apps/server`, `packages/shared`) | Shared types and state machine |
| Frontend | Vite + React 19, Tailwind v4, TanStack Query, Zustand, `react-zoom-pan-pinch`, `lucide-react`, `qrcode.react` | Fast, pinch-zoom on phones |
| Chat SDK | `@nexconn/engine` + `@nexconn/chat` **26.5.1, pinned exactly** (chat peer-requires engine `=26.5.1`) | Core requirement |
| Chat UI | Custom React UI, **not** `@nexconn/chatui` | ChatUI is a Lit app shell. Our cards live inside the drawing UX and render redlines. |
| Backend | Hono, zod, `jose`, pino, undici | Small, typed, one process |
| DB | Postgres 16 + Drizzle | Transactions, `FOR UPDATE`, unique constraints |
| PDF | `@react-pdf/renderer` + `@resvg/resvg-js` | No headless Chrome in prod |
| Hosting | One Docker service (Railway / Render / Fly.io) serving API + SPA, managed Postgres | One origin, always-on worker for outbox, pool, cleanup |

### 13.2 Configuration
- **Environment variables:**
  - `DATABASE_URL`
  - `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET` (server only)
  - `NEXCONN_API_PRIMARY=api.sg-light-api.com`, `NEXCONN_API_BACKUP=api-b.sg-light-api.com`
  - `VITE_NEXCONN_APP_KEY`, `VITE_NEXCONN_AREA=SG`
  - `SESSION_JWT_SECRET`, `INVITE_HMAC_SECRET`, `ADMIN_KEY`, `PILOT_ACCESS_CODE`, `NEXCONN_WEBHOOK_SECRET`
- **Repo layout:**
  - `apps/web/src/{nexconn,drawing,room,demo,pilot}`
  - `apps/server/src/{nexconn,domain,outbox,demo,pdf,webhook,db}`
  - `packages/shared`, `assets/meridian`, `e2e`
  - `docs/{nexconn-notes.md,pilot/,writeup/}`

### 13.3 Keeping it alive through judging
- **Free plan validity:** check the expiry date in the console. If it would lapse before judging ends, ask the organisers or Nexconn support about extending the free plan, or create the production app late enough that its month covers judging.
- **Headroom alarms:** MAU above 1,500, concurrent connections above 70, or upload usage above 400 MB trigger an alert and automatically tighten demo claims.
- **Monitoring:** pino JSON logs, an uptime monitor on `/healthz`, the prod smoke e2e, and a `/status` page.
- **Graceful degradation:** polling fallback, retry toasts, synchronous seeding fallback.
- **Security:**
  - App Secret on the server only (grep the built bundle before release)
  - Zod everywhere; images ≤ 1.5 MB
  - Webhook signature verification
  - Signed, expiring join and invite links
  - Rate limits on claims, pin creation, and nudges
  - No PII in demo data. The App Key is public by design.
- **Licences:** Nexconn packages are Apache-2.0, our repo is MIT, and all assets are original.

---

## 14. Build order (dependency-driven)

Each phase ends with a demonstrable exit criterion. Workstreams: **A** = backend + Nexconn, **B** = frontend, **C** = content, pilots, video. Solo builders follow A → B within each phase and run C alongside.

| Phase | A: Backend / Nexconn | B: Frontend | C: Content / growth | Exit criterion |
| --- | --- | --- | --- | --- |
| **1. Foundations** | Console app + settings (§4.8), Platform API client, **walking skeleton (§4.9)**, repo + CI + deploy to the public URL | Vite scaffold, routing, engine bootstrap, connection chip | Pilot outreach list, Nexconn skills installed for the coding agent | Two tabs chat in a private subchannel on the public URL. §4.9 answered. |
| **2. Core model** | Schema + migrations, `derivePinState` + tests, outbox, demo pool + seeder + claim, session JWT, join links | Sheet SVG generator, viewer (pan/zoom/pinch, layers, pin overlay, deep link) | Seed copy, field photos, thumbnails | A judge claims a seeded project and sees 4 correct pins |
| **3. Hero loop** | Proposals + `pt:proposal` metadata, sign-offs with idempotency + 409, decisions, `pt:pinstate`, `pt:jump` with mentions | Room: history, text, photos, replies, cards. Proposal composer + redline. Sign-off bar. Live pin colours. QR join. Kick modal. Polling fallback. | Rehearse on phone + laptop | **Spec demo steps 1–3 work on two real devices** |
| **4. Handover** | `buildDecisionRecord`, PDF, record hash | Refresh consistency, PDF download, guided tracker | Storyboard video | **Step 4 works.** Hero e2e green on prod. |
| **5. Breadth** | Holds/evidence/clear, raise-RFI flow, nudge | Hold and evidence UI, raise RFI, issue list + filters, Waiting on you, role switcher, activity drawer | Pilot sessions begin | All 4 seeded pins playable. A fresh RFI works end to end. |
| **6. Traction** | Pilot projects, raster upload, invites, webhook receiver, metrics | Pilot create/upload, invite accept, feedback prompt | Run pilots, ship fixes, collect quotes | First webhook-verified pilot users |
| **7. Hardening** | Rate limits, cleanup, headroom alarms, `/status`, scheduled smoke | Mobile polish, a11y pass, performance budget | Record video, write-up PDF, README | Release candidate tagged `v1.0` |
| **8. Submit** | Final deploy, secret scan, repo public | Final visual QA | Fill the form: app link, repo, video, PDF with App Key, traction proof | Submitted. Smoke e2e green. |

**Cut order if anything slips** (cut from the top first):
1. P2 items
2. Activity drawer
3. Role switcher
4. Tracker automation (keep a static checklist)
5. Issue-list filters beyond status
6. Pilot sheet upload (run pilots in a demo-style project with their own question + photo)

**Never cut:** the two-device live flow, idempotent server-validated approvals, refresh consistency, the PDF register, the mobile layout, the deployed URL.

---

## 15. Submission package

### 15.1 Repository (public)
The README covers:
- One-paragraph pitch
- Live URL and "try it in 60 seconds"
- GIF of the two-device flow
- Architecture diagram
- **"Where Nexconn is used"** (§15.3)
- Setup (`pnpm i && docker compose up -d && pnpm dev`), env vars, tests, licence

Keep a `.env.example` in the repo. Run a secret scan of the full history before making the repo public.

### 15.2 Demo video (≤ 3:00; laptop + phone on screen together)

| Time | Shot | Voice-over beat |
| --- | --- | --- |
| 0:00–0:15 | Duct hitting a beam, then the drawing with the red pin | "Has Structural agreed to this route, and on which drawing?" |
| 0:15–0:35 | Start as MEP lead → pin opens: brief, photo, reviewers | Location, conversation, reviewers in one place |
| 0:35–1:00 | Draw dashed reroute, post, approve for MEP → both screens "In review · Waiting for Structural" | What the site lead sees while a review is outstanding |
| 1:00–1:30 | Phone: Jump to pin → same spot, Rev B → asks "Does the dashed line show the new route?" → laptop receives and replies | Two independently connected Nexconn users, live |
| 1:30–1:50 | Phone: Approve → **both pins turn green**. Two named approvals on Rev B. A double-tap still shows one. | Server-verified, one approval per reviewer and version |
| 1:50–2:10 | Refresh both → export PDF → same proposal, revision, names, hash | Handover for the next shift |
| 2:10–2:30 | Slab: hold → evidence → clear → complete (sped up) | Exception path |
| 2:30–2:45 | Architecture card + activity drawer | The SDK interactions, by name |
| 2:45–3:00 | Webhook-verified pilot numbers + quote, $49/project, guests free | Real users on Nexconn, path to a product |

### 15.3 Write-up PDF (App Key on page 1)
1. Problem and scenario (beam clash), and the buyer
2. Walkthrough with screenshots (4 steps + exception path)
3. **Nexconn SDK-backed interactions**

| Interaction | Client SDK | Platform Chat API |
| --- | --- | --- |
| Join a project as a person | `NCEngine.initialize`, `NCEngine.connect` | `/v4/auth/access-token/issue`, `/v4/community-channel/join` |
| Project and rooms | `CommunitySubChannel` | `/v4/community-channel/create`, `/subchannel/create`, `/private-subchannel/member/add` |
| Discuss a fix | `SendTextMessageParams`, `SendReferenceMessageParams`, `Helper.createSendImageMessageParams` + `sendMediaMessage` | — |
| Structured RFI entries | `registerCustomMessages` (8 `pt:*` types), `MessageHandler.onMessageReceived` | `/v4/community-channel/message/send` |
| Live proposal status | `onCommunityChannelMessageMetadataChanged` | `/v4/community-channel/message/metadata/set` |
| Bring in a discipline | live `pt:jump` + `unreadCount` badges | `message/send` with `hasMention` + `mentionedInfo` in `disc*` |
| Live pin colours | status messages on `board` | `message/send` with `shouldPersist: 0` |
| Reopen a room | `BaseChannel.createMessagesQuery().loadNextPage()` | — |
| Reconnect / multi-device | `ConnectionStatusHandler` (auto-reconnect, `31010` kick) | Outbox with dedupe keys |
| Real-user evidence | — | `user:connection_status` webhook |

4. Integrity design: server authority, idempotency, `seq` ordering, forged-message defence
5. UX decisions: mobile bottom sheet, status text + shape, guided tracker
6. Business: buyer, price, free guests, growth loop, unit economics, pilot results (pilot vs sample rows), quote with permission
7. What's next

### 15.4 Pre-submit checklist
- [ ] Live URL works in an incognito window on desktop and on a phone on cellular data
- [ ] Pool depth ≥ 5. Smoke e2e green. Plan headroom OK. Free-plan expiry covers judging.
- [ ] App Key on the form and in the PDF. **App Secret nowhere** (repo, history, built bundle).
- [ ] Repo public with README and licence
- [ ] Video playable while logged out
- [ ] Metrics export dated, pilot vs sample separated, webhook-backed
- [ ] Every claim in the write-up demonstrable in the live app

---

## 16. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Free plan expires or limits hit during judging (one month, 2,000 MAU, 100 concurrent, 500 MB upload) | Med | **High** | Check expiry, headroom alarms, demo claim caps, photo compression, smoke runs on fixed users |
| A §4.9 behaviour differs from expectations | Low–Med | Med | Walking skeleton first, with a fallback per item |
| Invalid IDs (underscore, > 20 chars) | Low | High | Shared validators + unit tests |
| Bot exceeds the 100-community limit | Eliminated | — | `ptbot` sends as a non-member, site lead creates the community |
| Custom message > 10 KB | Low | Med | Size guard in the contract tests, ≤ 64 route points |
| Rate limits during seeding | Low | Med | Pre-warmed pool, token bucket (≤ 15/s per subchannel) |
| Judge uses only one device | High | Med | Per-tab identity, role switcher, prominent QR |
| Flaky network at judging | Med | High | Polling fallback, server-authoritative decisions, refresh-safe |
| PDF and app disagree | Low | High | Single `buildDecisionRecord`, record hash, e2e PDF assertion |
| 7-day chat retention | Certain | Low | The decision record lives in Postgres |
| Pilot recruitment slips | High | Med | Start in Phase 1, low-ask sessions, report honestly even if small |
| Scope creep | High | High | P0/P1/P2 tiers and cut order |

---

## 17. Definition of done (maps to the spec's demo script)

1. **Propose the reroute.** MEP lead opens RFI-001, draws a dashed route, posts Proposal v1 with cost/schedule impact, and approves for MEP. Both devices show **"In review · Waiting for Structural"** within 3 s.
2. **Follow the alert.** On the second device, Structural taps Jump to pin and lands on the same location on C-103 Rev B with the room open. Structural asks a free-text question, and MEP sees it live and replies. A judge-typed question works the same way.
3. **Make the decision.** Structural taps **Approve proposal**. Both pins turn green and read "Review complete." The pin shows two named approvals with roles, times, v1, Rev B. Repeated clicks and reconnects still show one approval per reviewer.
4. **Hand it over.** After a refresh, both devices show identical state. The exported PDF shows the same proposal, revision, reviewers, status, and record hash.
5. **Explore.** A fresh issue can be raised from a blank spot. RFI-002 is waiting for review. RFI-003 completes hold → evidence → clear → approve. RFI-004 shows a completed review with a superseded version.
6. **Submit.** The form has the app link, public repo, video, write-up PDF with App Key, and webhook-backed traction proof reported separately from sample activity.

---

## Appendix A: Verified Nexconn references

| Topic | Fact | Source |
| --- | --- | --- |
| Packages | `@nexconn/chat` 26.5.1 needs `@nexconn/engine` `=26.5.1`. `@nexconn/chatui` 26.5.0 is ESM-only Lit with peers `lit ^3.3.2`. | npm |
| Init/connect | `NCEngine.initialize({appKey, areaCode})` (default `AreaCode.SG`). Register custom messages **before** `connect`. Connect once; the SDK reconnects every 5 s. | `/chatsdk-web/init`, `/connection/connect`, `/connection/reconnect-kick` |
| Kick | `ConnectionStatus.DISCONNECTED` + code `31010`. No auto-reconnect afterwards. | `/chatsdk-web/connection/reconnect-kick` |
| Image helper | `Helper.createSendImageMessageParams(file)` → `channel.sendMediaMessage(params)` | SDK types, `/chatsdk-web/community-channel/chat` |
| History | `BaseChannel.createMessagesQuery({channelIdentifier, startTime, pageSize 1–100, isAscending})`. Requires cloud retention. | `/chatsdk-web/community-channel/get-history-message` |
| Unread | `CommunitySubChannel.reload()` → `unreadCount`. No unread-message list on Web. | `/chatsdk-web/community-channel/get-unread-count` |
| Community limits | 10,000 members. ≤ 100 communities per user. ≤ 50 subchannels. Subchannel ID letters/digits ≤ 20. Community ID letters/digits ≤ 64. | `/platform-chat-api/community-channel/*` |
| Private subchannels | Members must be community members (error `24406`), ≤ 20 per add. A non-member send fails silently. | `/platform-chat-api/community-channel/private-channel/*` |
| Server send | Sender receives the message if online. Custom content ≤ 10 KB. Metadata keys ≤ 32, values ≤ 4096. 100/s and 20/s per subchannel. | `/platform-chat-api/message/community-channel/send-community-channel` |
| Auth | Headers `App-Key`, `Nonce` (≤ 18 chars), `Timestamp` (ms), `Signature = sha1(secret+nonce+timestamp)`. Success `code: 0`. | `/guides/rest-apis/im-server-integration` |
| Domains | SG `api.sg-light-api.com` / `api-b.sg-light-api.com`. Fail over on a 5 s timeout. Keep-alive < 55 s and < 80 reuses. | `/platform-chat-api/prepare-to-use-api/base-url` |
| Community service | Restrict access to members. Pre-join history toggle. 7-day retention. | `/platform-chat-api/community-channel/service-config` |
| Plans | Community on Free and Pro, not Starter. Free: 1 month, 2,000 MAU, 5% concurrent, 500 MB. Pro 2k MAU tier: $360/month. | `/guides/realtime-chat/intro-chat/pricing-plans` |
| Presence webhook | `user:connection_status` with `status "0"` connected, `"1"` disconnected, `"2"` logged out | `/platform-chat-api/webhook/user/connection-status` |
| AI tooling | `npx skills add https://github.com/NexconnAI-Dev/nexconn-skills.git` (skill `nexconn-chat`), plus the nexconn-console MCP server | `/chatsdk-web/build-with-ai/install-skills` |
