# AI Digest Telegram - Design Spec

## Overview

A personalized AI news digest system that fetches content from multiple sources, generates summaries using GitHub Copilot CLI (`gpt-5-mini`), and delivers them to users via Telegram. Users configure preferences through a Telegram Bot or Web UI.

## Architecture

```
User (TG Bot / Web UI)
       ↓
  CF Workers → KV (user settings, invite codes)

GitHub Actions (cron, 8 time slots/day)
       ↓
  Read KV all user settings (CF API, requires CF_API_TOKEN secret)
       ↓
  Filter users by current time slot in code
       ↓
  Fetch sources (RSS/API, per-source timeout 10s)
       ↓
  copilot cli --model gpt-5-mini (filter + summarize)
       ↓
  Send digest to Telegram (per user preferences, with retry)
```

### Component Split

| Component | Responsibility | Runtime |
|-----------|---------------|---------|
| CF Workers | TG Bot webhook, settings API (for Web UI + Actions) | Cloudflare |
| GitHub Pages | Static Web UI | GitHub |
| CF KV | Store user settings, invite codes | Cloudflare |
| GitHub Actions | Fetch sources, AI summarize, send TG messages | GitHub |

## Scheduling

- 8 time slots per day: `0, 3, 6, 9, 12, 15, 18, 21` (UTC+8)
- User picks a preferred time → rounded to nearest slot (e.g. 1:00 → 0:00, 5:00 → 3:00)
- Each user receives exactly 1 push per day
- Actions runs all 8 slots; if no users in a slot, exit early
- One batch per slot: fetch sources → deduplicate → summarize by topic → distribute to all users in that slot

## Access Control

- Invite code system: admin generates codes, stores in KV
- Invite codes: 16-char alphanumeric, single-use
- Users must provide a valid invite code via TG Bot (`/start <code>`) or Web UI
- No code = no access
- Rate limit: max 3 invalid `/start` attempts per user per hour
- Admin commands via TG Bot: `/admin_invite` (generate code), `/admin_revoke <user_id>`, `/admin_list`
- Admin identified by hardcoded Telegram ID in env var

## User Settings (KV Schema)

Key: `user:{telegram_id}`

```json
{
  "telegram_id": 123456,
  "target_type": "dm" | "chat",
  "target_id": "-100xxx",
  "topics": ["ai-safety", "llm", "open-source"],
  "time_slot": 9,
  "lang": "zh-TW" | "en",
  "style": "mixed" | "brief" | "deep",
  "custom_sources": ["https://example.com/feed.xml"],
  "invite_code": "abc123",
  "created_at": "2026-03-12T00:00:00Z",
  "active": true,
  "consecutive_failures": 0
}
```

- `target_type: "dm"` — send to user's DM with the bot (uses `telegram_id`)
- `target_type: "chat"` — send to a group/channel (bot must be a member; verified on `/target` set)

Key: `invite:{code}` → `{ "created_by": "admin", "used_by": null, "created_at": "..." }`

No separate slot index. Actions reads all users and filters by `time_slot` in code (feasible at 50 users).

## Sources

### Default Sources

| Category | Sources | Fetch Method |
|----------|---------|-------------|
| Research | arXiv (cs.AI, cs.CL, cs.LG) | API (3s between requests) |
| Research | HuggingFace trending | RSS |
| Tech Media | TechCrunch AI, MIT Tech Review, The Verge AI, Ars Technica | RSS |
| Company Blogs | OpenAI, Anthropic, Google AI, Meta AI, NVIDIA | RSS |
| Community | Hacker News (AI-tagged) | Firebase API |
| Newsletters | Import AI, Latent Space, AI Snake Oil | RSS |
| Independent | Simon Willison's Weblog | RSS |

- Per-source fetch timeout: 10 seconds
- If a source fails, skip it and continue with others
- Reddit excluded (OAuth complexity, not worth it for MVP)

### Custom Sources

- Users can add RSS/Atom feed URLs (max 5 per user)
- Allowed domains whitelist (configurable in env)
- URL validated: must return valid RSS/Atom XML

## Deduplication

- Dedup key: URL normalized (strip tracking params, trailing slash)
- KV key `dedup:{date}` stores a set of URL hashes sent today
- Before sending, check if any item's URL hash already exists
- TTL: 48 hours (auto-expire via KV TTL)

## Topics

Predefined topic tags users can subscribe to (max 5 per user):

- `llm` - Large language models
- `ai-safety` - Safety and alignment
- `ai-agents` - AI agents and tool use
- `open-source` - Open source models and tools
- `computer-vision` - Vision models
- `robotics` - Robotics and embodied AI
- `ai-coding` - AI for software development
- `ai-policy` - Regulation and policy
- `industry` - Company news, funding, launches
- `research` - Academic papers and breakthroughs

## Output Format

All content delivered directly via Telegram. Each article includes original source link.

### Mixed (default)

```
📰 AI Daily Digest - 2026-03-12

━━━ Featured ━━━

1️⃣ Claude 4.5 發布
多模態能力大幅提升，首次在基準測試中全面超越 GPT-5。
🔗 https://anthropic.com/...

2️⃣ Meta 開源 LLaMA 5
700B 參數量，開源模型首次達到 GPT-5 水準。
🔗 https://ai.meta.com/...

3️⃣ EU AI Act 執行細則
高風險 AI 系統需在 2027 年前完成合規認證。
🔗 https://techcrunch.com/...

━━━ Quick Bites ━━━

• Google 推出 AI Studio 2.0 🔗 https://...
• NVIDIA 發布新推理晶片 🔗 https://...
• HuggingFace 月活突破千萬 🔗 https://...
```

### Brief

5-10 items, one line each with link.

### Deep

3-5 featured articles, 2-3 sentence summaries with link.

### Message Length Control

- AI prompt instructs model to keep total output within 4096 chars
- If deep style exceeds 4096, split into multiple messages at article boundaries
- Each message is self-contained (has header on first, continues numbering on subsequent)

### Empty Digest

- If no relevant content found for a user's topics, skip silently (no message sent)

## AI Summarization Strategy

- Generate one base summary per (topic_set, lang) combination
- E.g. if 3 users in a slot all subscribe to `llm + ai-agents` in `zh-TW`, generate once and reuse
- Style formatting (mixed/brief/deep) applied as post-processing on the base summary
- Prompt template and expected output format (JSON) defined in `scripts/prompts/`

### Copilot CLI Fallback

- If `copilot cli` fails or is unavailable, fall back to direct API call (configurable model endpoint in env)
- Log all AI invocation results for debugging

## Telegram Delivery

### Retry Strategy

- On 429 (rate limit): exponential backoff, max 3 retries
- On 403 (bot blocked/kicked): mark user `active: false`, increment `consecutive_failures`
- On other errors: retry up to 2 times
- After 5 consecutive delivery failures across days, auto-deactivate user

### Webhook Security

- CF Worker validates `X-Telegram-Bot-Api-Secret-Token` header on all incoming webhooks
- Secret token set via `setWebhook` API call, stored in env var

### Web UI Auth

- Telegram Login Widget with HMAC-SHA-256 verification using bot token
- Reject logins older than 5 minutes (check `auth_date`)

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start <invite_code>` | Register with invite code |
| `/topics` | View/set topic subscriptions |
| `/time` | Set preferred delivery time |
| `/lang` | Switch language (zh-TW / en) |
| `/style` | Set output style (mixed/brief/deep) |
| `/target` | Set delivery target (dm/chat) |
| `/sources` | Manage custom RSS sources |
| `/status` | View current settings |
| `/stop` | Pause subscription |
| `/resume` | Resume paused subscription |
| `/preview` | Generate a sample digest with current settings |
| `/help` | Show available commands |
| `/admin_invite` | (admin) Generate invite code |
| `/admin_revoke <id>` | (admin) Revoke a user |
| `/admin_list` | (admin) List all users |

## Web UI

Static single-page app hosted on GitHub Pages:

- Login via Telegram Login Widget (HMAC verified by CF Worker API)
- Dashboard showing current settings
- Topic picker (checkboxes)
- Time slot selector
- Language and style toggles
- Custom source manager
- Invite code input for new users
- All reads/writes go through CF Worker API endpoints (CORS enabled for Pages domain)

## GitHub Actions Workflow

```yaml
on:
  schedule:
    - cron: '0 16,19,22 * * *'   # 0,3,6 UTC+8
    - cron: '0 1,4,7,10,13 * * *' # 9,12,15,18,21 UTC+8
  workflow_dispatch:
```

Secrets required:
- `CF_API_TOKEN` — Cloudflare API token (KV read access)
- `CF_ACCOUNT_ID` — Cloudflare account ID
- `CF_KV_NAMESPACE_ID` — KV namespace ID
- `TELEGRAM_BOT_TOKEN` — Telegram bot token
- `GITHUB_TOKEN` — for Copilot CLI auth (provided by Actions)

Steps:
1. Determine current time slot from UTC time
2. Read KV: list all `user:*` keys, filter by `time_slot` and `active: true`
3. If no users in this slot, exit early
4. Collect all unique (topics, lang) combinations
5. Fetch sources relevant to those topics (parallel, per-source timeout)
6. Run `copilot cli --model gpt-5-mini` to filter and summarize (one call per unique topic+lang combo)
7. Format messages per user style preference, include original source links
8. Send via Telegram Bot API with retry logic (split if exceeds 4096 chars)
9. Update `dedup:{date}` in KV
10. On any failure, send error notification to admin via Telegram

## Monitoring

- Actions workflow failure → notify admin Telegram
- Per-run summary logged: sources fetched, articles found, users notified, errors
- User delivery failures tracked in `consecutive_failures` field

## Limits

| Resource | Limit |
|----------|-------|
| Total users | 50 (initial) |
| Topics per user | 5 |
| Custom sources per user | 5 |
| Pushes per user per day | 1 |
| Actions runs per day | 8 |
| KV reads per day | 100,000 (free tier) |
| Invalid /start attempts | 3 per user per hour |

## Tech Stack

- **Runtime**: Cloudflare Workers (TypeScript), GitHub Actions
- **Storage**: Cloudflare KV
- **AI**: GitHub Copilot CLI with gpt-5-mini (fallback: configurable API endpoint)
- **Bot**: Telegram Bot API (webhook mode via CF Workers)
- **Web UI**: Static HTML/JS on GitHub Pages, calls CF Worker API
- **Language**: TypeScript (CF Workers), Python (Actions scripts)
- **Shared Contract**: KV schema defined as JSON Schema in `schemas/` directory, used by both TS and Python sides
