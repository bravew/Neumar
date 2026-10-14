---
summary: "Per-provider responsibility matrix for the two live channel runtimes and the legacy Slack gateway: inbound transport, credentials, identity, permissions, persistence, scheduling, and stop behavior, each cell cited to code, plus the decision needed on a canonical runtime"
read_when:
  - Choosing or reviewing a canonical channel runtime
  - Migrating a provider between the plugin runtime and the gateway runtime
  - Tracing where a channel message is authenticated, persisted, or scheduled
  - Reviewing the Slack duplication (ChannelManager Slack plugin vs legacy slack-gateway)
title: "Channel Ownership and Contracts"
---

# Channel Ownership and Contracts

This document is the responsibility matrix requested by issue #222, part of epic
#193. It records what each live channel provider actually does today, with a
`path:line` citation for every cell and the live consumer named. It is a
pre-migration inventory, not a design. No runtime is chosen here; see
[Decision needed](#decision-needed).

Evidence was read from the tree at `1bb20406de946723795f7f9fed20777b7fa00d58`,
which is the head of `epic/193-architecture-ownership` and the commit this branch
started from. Node v26.11.1, pnpm 11.22.0. Line numbers are valid for that
commit only; confirm them again if the file has moved since.

## 1. Runtimes, not providers

There are three channel code paths in the API, and they overlap by provider.

| # | Runtime | Code | Loaded by | Live consumers |
|---|---|---|---|---|
| A | Plugin runtime ("ChannelManager") | `src-api/src/shared/channels/` | `http-daemon.ts:589-590` calls `getChannelManager().loadAndStartAll()` | `app/api/channels.ts`, `shared/automation/delivery.ts`, `shared/video/share.ts`, `shared/automation/engine.ts` |
| B | Gateway runtime | `src-api/src/shared/services/gateway/` | No production caller of `startGateway()` (`src-api/src/shared/services/gateway/index.ts:22`) | `app/api/channels.ts` (`getGateway()` at `:46`), `app/api/channels.ts:1198`, `:1263` webhook routes |
| C | Legacy Slack gateway | `src-api/src/shared/services/slack-gateway.ts` | `app/api/slack.ts:305` on `POST /slack/gateway/start`; no startup call site | `app/api/slack.ts`, `shared/services/slack-cowork-handler.ts`, `components/settings/SlackGatewaySettings.tsx` |

Runtime B is only partially live. `getGateway()` is constructed lazily
(`core/gateway.ts:466-471`) but nothing calls `Gateway.start()`
(`core/gateway.ts:49`) in the shipped API; the only wrapper that would,
`startGateway()` (`shared/services/gateway/index.ts:22-37`), has no caller
anywhere in `src/`, `src-api/src/`, or `src-tauri/src/`. The consequence is
load-bearing for the whole matrix:

- `getGateway().getAdapter(id)` (`core/gateway.ts:294-296`) reads
  `this.adapters`, which `start()` populates at `core/gateway.ts:77-92`. With no
  `start()`, that map is empty and the two webhook routes below return their
  "adapter not running" responses.
- Gateway adapters receive inbound messages only through
  `adapter.onMessage(...)`, which is wired in `connectChannel()`
  (`core/gateway.ts:173-177`) and therefore also never runs.
- The gateway's own tables (`gateway_channels`, `gateway_identities`,
  `gateway_sessions`, `gateway_messages`, `gateway_subscriptions`,
  `gateway_audit_log`) are created only by `initializeGatewaySchema()`
  (`shared/services/gateway/shared/db/schema.ts:13`), which has no caller. Only
  `gateway_channels` and `routing_rules` exist in the shipped database, created
  by migration 008 (`shared/db/migrations/008_gateway_routing_rules.ts:18`,
  `:29`). Runtime A never reads the `gateway_*` tables.

So the two webhook routes in `app/api/channels.ts` are the live part of runtime
B: they are mounted (`http-daemon.ts:236`) and reachable even though the
adapters they dispatch into are not running. That is a functional gap, not a
documentation gap, and it is recorded in [Unconfirmed and gaps](#4-unconfirmed-and-gaps) below.

### Runtime A lifecycle

- Startup: `loadAndStartAll()` (`channel-manager.ts:442`) reads every
  `channel_config` row, instantiates the matching `BasePlugin` from
  `getPluginCtors()` (`channel-manager.ts:82-98`, which imports
  `./telegram/index`, `./discord/index`, `./slack/index`, `./lark/index`), then
  calls `startAll()` (`:457`).
- `startAll()` requires an enabled config **and** a vault token
  (`channel-manager.ts:460-467`), then takes a lease (`:474`) before
  `plugin.start()` (`:481`).
- Plugin lifecycle is `BasePlugin.start/stop/restart/scheduleRestart`
  (`base-plugin.ts:78`, `:95`, `:110`, `:125`).
- Shutdown: `stopAll()` (`channel-manager.ts:502`) is called from
  `http-daemon.ts:403`.
- Dev gating: `channelsDisabled` (`http-daemon.ts:146-148`) skips the whole
  runtime unless `NEUMA_DEV_CHANNELS=1`, and `NEUMA_DISABLE_CHANNELS=1` is a hard
  kill switch.

## 2. Per-provider matrix

Legend: "A" plugin runtime, "B" gateway runtime, "C" legacy Slack gateway.
`shared/channels` is relative to `src-api/src/`; the gateway tree is
`src-api/src/shared/services/gateway/`.

### 2.1 Slack

| Field | Runtime A (live) | Runtime C (live, manual start) | Runtime B (opt-out) |
|---|---|---|---|
| Inbound | Bolt.js Socket Mode. `slack/index.ts:233-237` builds the `App` with `socketMode: true`; handlers at `:245` (`message`) and `:384` (`app_mention`) | Bolt.js Socket Mode. `slack-gateway.ts:99-103` builds the `App`; handlers at `:195` (`message`), `:230` (`app_mention`), `:258` (`assistant_thread_started`) | Deliberately disabled. `gateway/channels/slack/adapter.ts:17-25` registers a factory that logs and returns `null` |
| Live consumer | `channel-manager.ts` `handleIncomingMessage()` (`:563`); settings and admin via `app/api/channels.ts` | `app/api/slack.ts:79` subscribes `onInboundMessage`, which calls `slackCoworkHandler.handleInboundMessage()` (`slack.ts:93-97`, `slack-cowork-handler.ts:99`) | `app/api/channels.ts` registry listing (`:1142-1159`) |
| Credentials | AES-256-GCM vault, keyed by config UUID. `getChannelToken()` at `channel-manager.ts:461`; `mergeAndSaveCredential()` at `app/api/channels.ts:381`; vault at `credential-vault.ts:262` (`initCredentialVault`), `:308` (`getChannelToken`). Token shape `{botToken, appToken}`, parsed at `slack/index.ts:205-215` | Separate encrypted file `slack-config.enc.json` in the app dir. `slack-config.ts:124` (`getSlackConfigPath`), `:217` (`loadSlackConfig`), decrypted fields `botToken`/`appToken` at `:251-263`; `toGatewayConfig()` (`slack-gateway.ts:291-302`) maps them in | Gateway `channels.slack` config in `gateway.json` (`gateway/shared/config/loader.ts:21`, schema `gateway/shared/config/types.ts:77-85`) |
| User identity | Platform user ID, qualified per workspace: `buildQualifiedUserId('slack', userId, {teamId})` (`workspace.ts:35-48`, called at `channel-manager.ts:1057`). `channel_users` keyed by `(config_id, platform_user_id)` (migration `003_multi_bot.ts:58-59`) | Platform user ID plus team, qualified the same way at `slack-cowork-handler.ts:157` and `:245`. Sessions are in-memory, keyed by `teamId/channelId/threadTs` (`:103-107`, `:50-61`) | `resolveIdentity()` keyed on `(channel_id, sender_id)` (`gateway/shared/auth/identity-resolver.ts:19-46`) |
| Permissions | Pairing plus tier. `SecurityPipeline.run()` (`security/pipeline.ts:39`) checks duplicate (`:44`), pairing (`:51-66`), viewer tier (`:69`), rate limit (`:74`), token budget (`:84`), guardrails (`:98`). Slash commands handled at `channel-manager.ts:2015`, `/pair` at `:1980`, `/stop` at `:2069` | None in the gateway pipeline. `handleInboundMessage()` debounces (`slack-cowork-handler.ts:109-131`) and dispatches to the agent at `:253` with no pairing, tier, rate-limit, or budget check. The cowork handler is not in the ChannelManager path | Tier gate in the router: `hasPermission(tier, 'send_message')` (`message-router.ts:591`), command gate at `:568` |
| Persistence | SQLite: `channel_messages` (`001_init.ts:780`) written at `channel-manager.ts:700` (inbound) and `:1651` (outbound), `channel_sessions` (`001_init.ts:763`) via `session-manager.ts:19-38`, `channel_audit_log` (`001_init.ts:797`) via `audit-log.ts:3-4`. Workspace per user and thread at `resolveChannelWorkDir()` (`workspace.ts:83-109`). Slack-scoped per-user credentials and MCP overlay loaded at `channel-manager.ts:1159` and `:1171` | In-memory `Map` only (`slack-cowork-handler.ts:88-90`); 24 h TTL and hourly cleanup (`:43-44`, `startCleanup()` at `:734`). Thread history is re-fetched from Slack each turn | `gateway_messages` and `gateway_sessions` (`gateway/shared/db/schema.ts:55`, `:81`), written at `message-router.ts:548` and `:982`, via `getOrCreateSession()` (`gateway/core/session-manager.ts:18`) |
| Scheduling | Delivery target for automations: `deliverToChannel()` resolves the plugin by `configId` then platform (`automation/delivery.ts:266-270`). Channel context for schedule tools built at `agent-context.ts:24` and passed at `channel-manager.ts` run site | `channelContext` with `platform: 'slack'` passed to `runAgent()` at `slack-cowork-handler.ts:262-269`; it omits `permissionTier` and `identityId`, and a missing tier denies at `connector-policy.ts:329-331` via `tierMeets()` (`:98-105`) | `gateway_subscriptions` and `/subscribe` (`gateway/core/command-handlers.ts:91`) and task lifecycle notifications (`gateway/core/event-listener.ts:31`, `:44`) |
| Stop | `/stop` command (`channel-manager.ts:2069-2085`) and sentiment stop (`:739-747`) abort the active run and delete the agent session; queued message cleared; plugin shutdown `slack/index.ts:765` sets presence away and calls `app.stop()` | New message aborts the previous run (`slack-cowork-handler.ts:145-150`). `POST /slack/gateway/stop` (`slack.ts:318`) unwires the handler and calls `slackGateway.stop()` (`slack-gateway.ts:124`), which calls `app.stop()` at `:130` | `Gateway.stop()` disconnects adapters (`gateway/core/gateway.ts:139-148`); `stopChannel()` at `:338-346`. Not reachable while the gateway is not started |

The two live Slack stacks both open a Socket Mode connection and both parse the
same `{botToken, appToken}` pair, but from different stores. They differ on
permissions (A has a pipeline, C has none), persistence (A writes SQLite, C
keeps a `Map`), and command handling (A has `/pair`, `/stop`, `/new`; C has
`/forget` only, at `slack-cowork-handler.ts:153`).

### 2.2 Telegram

| Field | Runtime A (live) | Runtime B (not started) |
|---|---|---|
| Inbound | grammy `Bot` plus `@grammyjs/runner` long polling. `telegram/index.ts:100` builds the bot; `:402-416` starts the runner with an `allowed_updates` list | grammy `Bot`. `gateway/channels/telegram/adapter.ts:82` builds the bot; `connect()` at `:79`, `disconnect()` at `:163` |
| Live consumer | `channel-manager.ts:563` via `registerMessageHandler` (`:365-367`) | `gateway/core/gateway.ts:173-177`; `createChannel('telegram', ...)` factory at `gateway/channels/telegram/adapter.ts:701-715` |
| Credentials | Vault. `channel-manager.ts:461`; plain bot token in `channel_config.token` replaced by the `__vault__` sentinel (`credential-vault.ts:36`) | `gateway.json` `channels.telegram.botToken` (schema `gateway/shared/config/types.ts:60-66`) |
| User identity | Telegram user ID; group chats get `chatId:threadId` and `chatId:threadId:userId` session keys (`telegram/index.ts:114-125`). Telegram IDs are globally unique, so `buildQualifiedUserId` adds no qualifier (`workspace.ts:59-61`) | `senderId` on the normalized message; gateway `gateway_identity_channels` keyed `(channel_id, channel_user_id)` |
| Permissions | Same pipeline as Slack (`security/pipeline.ts:39-125`), including an in-process token claim guard: `claimTelegramToken()` at `telegram/index.ts:394-400` prevents a duplicate long-poll for the same token | Router gate at `message-router.ts:591`; tier from `defaultPermissionTier`, default `viewer` (`gateway/shared/config/types.ts:135`, default `:332`) |
| Persistence | `channel_messages`/`channel_sessions`/`channel_audit_log` as above; session key from `telegram/index.ts:123-125` | `gateway_messages`/`gateway_sessions` |
| Scheduling | Same automation delivery path (`automation/delivery.ts:266-270`) | `gateway_subscriptions` |
| Stop | `/stop` (`channel-manager.ts:2069`); plugin stop at `telegram/index.ts:424-437` stops the runner and releases the token claim | `gateway.ts:338-346` |

### 2.3 Discord

| Field | Runtime A (live) | Runtime B (not started) |
|---|---|---|
| Inbound | discord.js WebSocket. `discord/index.ts:97-112` builds the `Client` with message, reaction, and DM intents; `Events.MessageCreate` at `:138`; `login()` at `:231` | discord.js. `gateway/channels/discord/adapter.ts:104` builds the `Client`; `login()` at `:146`; `disconnect()` at `:150` |
| Live consumer | `channel-manager.ts:563` | `gateway/core/gateway.ts:173-177`; factory at `gateway/channels/discord/adapter.ts:689-698` |
| Credentials | Vault, plain bot token | `gateway.json` `channels.discord.botToken` (schema `gateway/shared/config/types.ts:67-73`) |
| User identity | Discord user ID with guild qualifier: `buildQualifiedUserId('discord', userId, {guildId})` (`workspace.ts:52-58`) | `senderId`; `gateway_identity_channels` |
| Permissions | Pipeline as above; `mention_only` gate in guild channels at `discord/index.ts:142-150` | Router gate at `message-router.ts:591` |
| Persistence | Same SQLite tables; Discord display name read from message metadata at `channel-manager.ts:2160-2161` | `gateway_messages`/`gateway_sessions` |
| Scheduling | Same automation delivery path | `gateway_subscriptions` |
| Stop | `/stop`; plugin stop at `discord/index.ts:243-247` calls `client.destroy()` | `gateway.ts:338-346` |

### 2.4 Lark / Feishu

Runtime A treats Lark as one plugin. Runtime B splits the same platform into two
registered adapters, `feishu` and `lark`, and only `feishu` has an adapter file
(`gateway/channels/index.ts:12` imports `./feishu/adapter`; there is no
`gateway/channels/lark/` directory). Runtime A's plugin is registered as
`lark` (`channel-manager.ts:94`).

| Field | Runtime A (live) | Runtime B (not started) |
|---|---|---|
| Inbound | Lark SDK `WSClient` long connection with an `EventDispatcher` for `im.message.receive_v1`, reactions, and `card.action.trigger`. `lark/index.ts:79-80` builds client and WS client; dispatcher at `:93-118`; `wsClient.start()` at `:121` | Same SDK, channel id `feishu`. `gateway/channels/feishu/adapter.ts:89-112` builds client, dispatcher, and WS client; `start()` at `:116`; `disconnect()` at `:130` |
| Live consumer | `channel-manager.ts:563` | `gateway/core/gateway.ts:173-177`; factory at `gateway/channels/feishu/adapter.ts:269` |
| Credentials | Vault, JSON `{appId, appSecret, verificationToken, encryptKey}` parsed by `parseLarkTokenConfig` at `lark/index.ts:64`. Startup probe at `:83` | `gateway.json` `channels.feishu.appId`/`appSecret` plus `encryptKey`/`verificationToken` (`gateway/channels/feishu/adapter.ts:29-36`, schema `gateway/shared/config/types.ts:94-99`) |
| User identity | Lark `open_id`/`user_id` with tenant qualifier: `buildQualifiedUserId('lark', userId, {tenantKey})` (`workspace.ts:46-54`) | `senderId` from `sender.sender_id.open_id` (`gateway/channels/feishu/adapter.ts:230-233`) |
| Permissions | Pipeline as above. Dedup by `event_id` via `shouldProcessEvent()` (`lark/index.ts:55`, used at `:153`) | Router gate at `message-router.ts:591` |
| Persistence | Same SQLite tables | `gateway_messages`/`gateway_sessions` |
| Scheduling | Same automation delivery path | `gateway_subscriptions` |
| Stop | `/stop`; plugin stop at `lark/index.ts:131-140` closes the WS client with `force: true` | `gateway.ts:338-346` |

### 2.5 WhatsApp (runtime B only)

| Field | Value |
|---|---|
| Inbound | Meta WhatsApp Business Cloud API webhook, not a socket. `POST /channels/whatsapp/webhook` (`app/api/channels.ts:1263`) verifies the HMAC and calls `adapter.handleWebhookEvent()` (`:1293`). Verification handshake on `GET /channels/whatsapp/webhook` (`:1247`). Normalization at `gateway/channels/whatsapp/cloud.ts:91` |
| Live consumer | The HTTP route itself. `getGateway().getAdapter('whatsapp')` at `app/api/channels.ts:1284`, guarded by a 503 when the adapter is absent (`:1287-1292`). With no `Gateway.start()`, that is the current response |
| Credentials | `gateway_channels.config` JSON for id `whatsapp`, read at `app/api/channels.ts:1264` and parsed by `parseWhatsAppCloudConfig()` (`cloud.ts:23-47`): `phoneNumberId`, `accessToken`, `webhookVerifyToken`, `appSecret`, optional `wabaId`/`graphVersion`. Not the vault. `validateWhatsapp()` (`app/api/channels.ts:289-295`) only returns a warning |
| User identity | WhatsApp phone number, normalized to E.164 digits by `normalizeWhatsAppTarget()` (`cloud.ts:49-57`); `senderId` set during webhook normalization (`cloud.ts:91-114`) |
| Permissions | Router gate at `message-router.ts:591` with `defaultPermissionTier` (`viewer`). Not reachable while the gateway is not started |
| Persistence | `gateway_messages`/`gateway_sessions` via `message-router.ts:548`/`:982` |
| Scheduling | `gateway_subscriptions` (`gateway/shared/db/schema.ts:105`) |
| Stop | `disconnect()` (`gateway/channels/whatsapp/adapter.ts:87-90`) only flips a flag; there is no socket to close. The webhook route stops answering when the adapter is removed from the map (`gateway.ts:338-346`) |
| Runtime class | `official` (`gateway/channels/whatsapp/adapter.ts:48`) |

### 2.6 iMessage (runtime B only, BlueBubbles bridge)

| Field | Value |
|---|---|
| Inbound | BlueBubbles posts webhooks. `POST /channels/imessage/webhook` (`app/api/channels.ts:1198`) rejects non-macOS hosts (`:1199-1201`), verifies an HMAC when a secret is configured (`:1231`, `verifyBlueBubblesWebhook` at `gateway/channels/imessage/webhook.ts:38-55`), then calls `adapter.handleWebhookEvent()` (`:1243`). Normalization at `webhook.ts:57-90` |
| Live consumer | The HTTP route. `getGateway().getAdapter('imessage')` at `app/api/channels.ts:1203`, 503 when absent (`:1212-1217`). Same not-started caveat as WhatsApp |
| Credentials | `gateway_channels.config` for id `imessage`: `serverUrl` and `password`, plus optional `webhookSecret` (`gateway/channels/imessage/adapter.ts:39-46`). The route falls back to the adapter's `webhookSecret()` then `webhookSecret`/`password` from config (`app/api/channels.ts:1222-1226`). `connect()` also requires a consent setting `imessage.consent.acceptedAt` (`gateway/channels/imessage/adapter.ts:37`, checked at `:81-88`) |
| User identity | iMessage handle address, or `uniqueId` fallback (`webhook.ts:101`) |
| Permissions | Router gate at `message-router.ts:591`. Consent gating happens in `connect()`, not per message |
| Persistence | `gateway_messages`/`gateway_sessions` |
| Scheduling | `gateway_subscriptions` |
| Stop | `disconnect()` (`gateway/channels/imessage/adapter.ts:110-114`) flips a flag. Webhooks keep arriving at the route until the adapter is removed |
| Runtime class | `bridge` (`gateway/channels/imessage/adapter.ts:61`) |

### 2.7 Linear (runtime B only, no live inbound)

| Field | Value |
|---|---|
| Inbound | Designed as a Linear comment webhook. `handleCommentWebhook()` exists at `gateway/channels/linear/adapter.ts:143-171` and normalizes a `Comment`/`create` payload. No caller: the live Linear webhook route `POST /linear/webhook` (`app/api/linear.ts:68`) uses `shared/services/linear.ts` directly and never touches this adapter |
| Live consumer | `app/api/channels.ts:1142-1159` (registry listing) and `:1165-1195` (enable/disable/reconnect). `connect()` at `linear/adapter.ts:72` only validates that a Linear API key exists |
| Credentials | Linear API key via `getLinearClientAsync()` (`linear/adapter.ts:76`); no gateway config fields |
| User identity | `payload.data.user.id`, fallback `'linear-user'` (`linear/adapter.ts:153`) |
| Permissions | Router gate at `message-router.ts:591` if a message were ever dispatched |
| Persistence | `gateway_messages`/`gateway_sessions`; none today because nothing dispatches |
| Scheduling | `gateway_subscriptions` |
| Stop | `disconnect()` (`linear/adapter.ts:90-94`) flips a flag |
| Runtime class | `official` (`linear/adapter.ts:63`) |

### 2.8 SMS (runtime B only, placeholder)

| Field | Value |
|---|---|
| Inbound | None implemented. `onMessage` is a no-op (`gateway/channels/sms/adapter.ts:92`) |
| Live consumer | Registry listing and enable/disable only (`app/api/channels.ts:1142-1195`) |
| Credentials | `gateway.json` `channels.sms` (`accountSid`, `authToken`, `fromNumber`, `webhookUrl`; schema `gateway/shared/config/types.ts:86-92`). `connect()` throws the setup banner when any is missing (`sms/adapter.ts:55-67`) |
| User identity | None; no inbound path |
| Permissions | None reachable |
| Persistence | None |
| Scheduling | `gateway_subscriptions` exists but nothing produces events |
| Stop | `disconnect()` (`sms/adapter.ts:69-71`) flips a flag; `isConnected()` always returns `false` (`:73-75`) |
| Runtime class | `experimental` (`sms/adapter.ts:46`) |

## 3. Cross-cutting ownership

### 3.1 Credentials

Two stores, no overlap:

- Runtime A uses the AES-256-GCM vault at `<appDir>/channel-creds.enc.json`
  (`credential-vault.ts:262`, `getChannelCredsPath()`), keyed by the
  `channel_config.id` UUID, with the sentinel `__vault__` left in the SQLite
  `token` column (`credential-vault.ts:36`). `channel_config.token` is defined at
  `001_init.ts:725-728`.
- Runtime B uses `gateway.json` in the app dir (`gateway/shared/config/loader.ts:21`),
  with `env:VAR` indirection resolved by `resolveEnvRefs()`
  (`gateway/shared/config/loader.ts:28-51`) and Zod validation at `:78-84`. Per-channel config lives under `channels.<id>`.
- Runtime C uses `<appDir>/slack-config.enc.json` (`slack-config.ts:124-126`),
  AES-256-GCM per field, key derived from hostname, username, and a nonce
  (`slack-config.ts:177-192`).

### 3.2 Identity and permissions

- Runtime A: `channel_users` (migration `001_init.ts:742`), unique on
  `(config_id, platform_user_id)` (`003_multi_bot.ts:58-59`). Tier defaults to
  `operator` in the table (`001_init.ts:748`). `SecurityPipeline` auto-approves
  in `access_mode: 'open'` (`security/pipeline.ts:51-66`), rejects viewers for
  message sending (`:69-71`), rate-limits per `channel_users.id` (`:74`),
  enforces a token budget (`:84`), and runs guardrails (`:98`). Pairing codes
  live in `channel_pairing_codes` (`001_init.ts:755`) with the service at
  `pairing-service.ts:12`, `:24`, `:52`.
- Runtime B: `gateway_identities` and `gateway_identity_channels`
  (`gateway/shared/db/schema.ts:29-39`, `:41-52`), tier default `viewer` in the
  table (`gateway/shared/db/schema.ts:33`), auto-created on first message by `resolveIdentity()`
  (`identity-resolver.ts:19-46`). Gating happens in the router: command gate at
  `message-router.ts:568`, `send_message` gate at `:591`, concurrency gate at
  `:625`. Tier vocabulary `viewer`/`operator`/`admin` is duplicated between the
  two runtimes (`shared/db/types.ts:922` and
  `gateway/channels/types.ts:149`).
- Runtime C: no identity store. The cowork handler keeps an in-memory session
  per thread and does not check pairing, tier, rate, or budget.

### 3.3 Persistence

- Runtime A writes `channel_config`, `channel_users`, `channel_pairing_codes`,
  `channel_sessions`, `channel_messages`, `channel_audit_log` (all created in
  `001_init.ts:725-806`), and leases in `channel_leases`
  (`024_channel_leases.ts:10`).
- Runtime B is designed around `gateway_*` tables created only by
  `initializeGatewaySchema()` (`gateway/shared/db/schema.ts:13`), which nothing
  calls. Only `gateway_channels` and `routing_rules` exist in practice
  (`008_gateway_routing_rules.ts:18`, `:29`).
- Runtime C persists nothing; sessions are in-memory with a 24 h TTL
  (`slack-cowork-handler.ts:43`, `:88-90`).

### 3.4 Scheduling and stop

- Outbound scheduling for runtime A is `deliverToChannel()`
  (`automation/delivery.ts:206`), reached from `deliver()` (`:110`, branch at
  `:115`), resolving a plugin by `configId` then platform (`:266-270`) and
  sending through `plugin.sendMessage` (`:290`). The automation engine holds the
  manager at `automation/engine.ts:968`. Video share delivery uses the same
  manager (`video/share.ts:163`).
- Runtime B scheduling is subscription based: `gateway_subscriptions`
  (`gateway/shared/db/schema.ts:105`), `/subscribe` at
  `gateway/core/command-handlers.ts:91`, task lifecycle notifications in
  `gateway/core/event-listener.ts:31` and `:44`.
- Runtime C scheduling is indirect: it passes `channelContext` with
  `platform: 'slack'` to `runAgent()` (`slack-cowork-handler.ts:262-269`), which
  schedule MCP tools use to resolve a delivery target. That context omits
  `permissionTier` and `identityId`, which are optional in the type
  (`core/agent/types.ts:575-603`).
- Stop behavior is covered per provider above. The one shared piece is the
  in-process lease: `ChannelManager` uses `NopLeaser` by default
  (`channel-manager.ts:360`), which never denies a second instance, while
  `DbLeaser` (`_shared/db-lease.ts:15`) would use `channel_leases`. The default
  is `NopLeaser`, so two API processes can start the same bot.

## 4. Unconfirmed and gaps

These are things I could not confirm from the tree. They are stated as open, not
as behavior.

- **Gateway runtime is not started by the shipped API.** I searched `src/`,
  `src-api/src/`, `src-api/test/`, and `src-tauri/src/` for `startGateway`,
  `stopGateway`, and `new Gateway(`. The only hits are the definitions in
  `shared/services/gateway/index.ts` and the lazy singleton in
  `core/gateway.ts:466`. I could not find any caller. If a packaged or desktop
  entry point starts it outside these trees, that caller is not in this
  repository.
- **`gateway_identities`, `gateway_sessions`, `gateway_messages`,
  `gateway_subscriptions`, `gateway_identity_channels`, and `gateway_audit_log`
  have no migration.** `initializeGatewaySchema()` would create them but has no
  caller. Whether they exist in a shipped database depends on a code path I
  could not find.
- **`POST /channels/imessage/webhook` and `POST /channels/whatsapp/webhook`
  return 503 today.** That follows from the adapter map being empty without
  `Gateway.start()`. I did not run the server to observe it, so this is a
  reading of the code, not a runtime observation.
- **Linear inbound is unwired.** `handleCommentWebhook()` has no caller; the
  live route at `app/api/linear.ts:68` bypasses it. Confirmed by search, not by
  observing a Linear webhook.
- **Whether the legacy Slack gateway starts at boot.** `gateway.autoStart`
  exists in the config type (`slack-config.ts:96-102`) and the API accepts it
  (`app/api/slack.ts:57`), but I found no code that reads `autoStart` to start
  the gateway at startup. Only the manual `POST /slack/gateway/start` route
  (`slack.ts:305`) starts it.
- **`NopLeaser` is the production default.** The constructor takes an optional
  `Leaser` (`channel-manager.ts:341-363`) and falls back to `NopLeaser`
  (`:360`). I found no call site that injects `DbLeaser`, so the multi-instance
  protection the `channel_leases` table implies is not active by default.
- **Slack Socket Mode duplication.** Both runtime A (`slack/index.ts:233`) and
  runtime C (`slack-gateway.ts:99`) can open a Socket Mode connection for the
  same workspace with different tokens and no coordination. What happens when
  both run is a platform-side question I did not test.
- **`doc/backend/gateway.md:159`** describes Slack in the gateway as using
  `slack-gateway.ts` through the unified pipeline. The current
  `gateway/channels/slack/adapter.ts:17-25` returns `null` and routes nothing.
  The document and the code disagree; I am reporting the mismatch rather than
  changing either.

## 5. Decision needed

The matrix shows three runtimes for one product surface, two live Slack stacks,
and a gateway runtime whose lifecycle entry point has no caller. Choosing a
canonical runtime changes the data model (vault vs `gateway.json` vs
`slack-config.enc.json`), the permission model (pipeline vs router vs none), and
the persistence model (SQLite vs in-memory), so it is a maintainer decision, not
an implementation detail. This document does not pick one.

Candidate canonical runtimes, with what each would imply. Listed for review, not
recommended:

1. **Runtime A, the plugin runtime (`shared/channels/`).** Today it is the only
   runtime with a startup call site, a credential vault, a permission pipeline,
   and durable persistence, and it already covers Slack, Discord, Telegram, and
   Lark. Making it canonical means porting WhatsApp and iMessage inbound into
   plugins, retiring the gateway adapters, and moving Slack off
   `slack-gateway.ts`.
2. **Runtime B, the gateway runtime (`shared/services/gateway/`).** It has the
   richer abstractions (identity, subscriptions, routing rules, circuit
   breaker) and the two webhook providers that runtime A lacks, but it is not
   started today and its core tables are not migrated. Making it canonical means
   giving it a real startup path, migrating the `gateway_*` schema, and porting
   the four plugin platforms.
3. **Runtime C, the legacy Slack gateway.** It has no permissions, no
   persistence, and no other provider. It is the smallest surface and the
   likeliest thing to retire rather than promote.
4. **A new unified runtime.** Neither existing runtime's interfaces
   (`BasePlugin` vs `ChannelAdapter`) match the other's message shape, so a
   third option is to define one adapter contract and migrate both. This is the
   largest change and the only one that avoids a partial overlap.

Migration itself is a separate sub-issue. Whichever candidate is chosen, the
work that follows is: pick the contract, port providers one at a time, migrate
callers, then delete the losing runtime in the same wave, per the LESSONS.md rule
"When you replace an internal API, migrate every caller and delete the old one
in the same wave". The maintainer's choice should be recorded on issue #222
before any migration PR is opened.

## Appendix: live consumers of runtime A

The manager is a singleton (`channel-manager.ts:2406`). Callers:

- `http-daemon.ts:84` (import), `:589-590` (startup), `:403` (shutdown)
- `app/api/channels.ts:15` (import), `:392` (`addConfig`), `:472` (bulk start),
  `:527` (`removeConfig`), `:547`, `:561` (`refreshConfig`), `:577`, `:757`,
  `:962` (`getStatus`), `:981`, `:991`, `:1018`
- `shared/automation/delivery.ts:267` and `:348`
- `shared/automation/engine.ts:968`
- `shared/video/share.ts:163`

## Appendix: live consumers of runtime B and runtime C

Runtime B:

- `app/api/channels.ts:45` (side-effect import that triggers adapter
  self-registration), `:46` (`getGateway`), `:1142-1159` (registry listing via
  `getRegisteredChannelIds()`), `:1165-1195` (enable/disable/reconnect),
  `:1203` (iMessage adapter lookup), `:1284` (WhatsApp adapter lookup)
- `http-daemon.ts:22` and `:238` (`/gateway` audit-log routes)

Runtime C:

- `app/api/slack.ts:22-23` (imports), `:79` (event subscription), `:93`
  (cowork handler dispatch), `:301-352` (status, start, stop, restart, test)
- `shared/services/slack-cowork-handler.ts:34` (imports `SlackInboundMessage`)
- `components/settings/SlackGatewaySettings.tsx:46` and `:78` (status and action
  calls to `/slack/gateway/*`), rendered from
  `components/settings/SlackConnectionSection.tsx:218`
