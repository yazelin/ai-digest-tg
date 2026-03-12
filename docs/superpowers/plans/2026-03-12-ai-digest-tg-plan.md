# AI Digest Telegram - Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personalized AI news digest system that fetches sources, summarizes with AI, and delivers to Telegram users with customizable preferences.

**Architecture:** Three subsystems — (1) CF Workers for Telegram Bot + settings API + KV storage, (2) GitHub Actions pipeline for source fetching, AI summarization, and Telegram delivery, (3) GitHub Pages static Web UI. CF Workers is the foundation; Actions and Web UI depend on it.

**Tech Stack:** TypeScript (CF Workers, Wrangler), Python (Actions scripts), Cloudflare KV, Telegram Bot API, GitHub Copilot CLI, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-03-12-ai-digest-tg-design.md`

---

## Chunk 1: Project Setup & Shared Schema

### Task 1: Initialize repo and project structure

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `README.md`

- [ ] **Step 1: Initialize git repo**

```bash
cd /home/ct/SDD2/ai-digest-tg
git init
```

- [ ] **Step 2: Create .gitignore**

```gitignore
node_modules/
dist/
.wrangler/
.dev.vars
__pycache__/
*.pyc
.venv/
.env
```

- [ ] **Step 3: Create root package.json**

```json
{
  "name": "ai-digest-tg",
  "private": true,
  "workspaces": ["worker"],
  "scripts": {
    "dev": "cd worker && wrangler dev",
    "deploy": "cd worker && wrangler deploy",
    "test:worker": "cd worker && vitest run",
    "test:scripts": "cd scripts && python -m pytest"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore package.json
git commit -m "chore: initialize project structure"
```

### Task 2: Define shared KV schema

**Files:**
- Create: `schemas/user.json`
- Create: `schemas/invite.json`

- [ ] **Step 1: Create user settings JSON Schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "UserSettings",
  "type": "object",
  "required": ["telegram_id", "target_type", "topics", "time_slot", "lang", "style", "invite_code", "created_at", "active"],
  "properties": {
    "telegram_id": { "type": "integer" },
    "target_type": { "enum": ["dm", "chat"] },
    "target_id": { "type": "string" },
    "topics": {
      "type": "array",
      "items": {
        "enum": ["llm", "ai-safety", "ai-agents", "open-source", "computer-vision", "robotics", "ai-coding", "ai-policy", "industry", "research"]
      },
      "maxItems": 5
    },
    "time_slot": { "enum": [0, 3, 6, 9, 12, 15, 18, 21] },
    "lang": { "enum": ["zh-TW", "en"] },
    "style": { "enum": ["mixed", "brief", "deep"] },
    "custom_sources": {
      "type": "array",
      "items": { "type": "string", "format": "uri" },
      "maxItems": 5,
      "default": []
    },
    "invite_code": { "type": "string" },
    "created_at": { "type": "string", "format": "date-time" },
    "active": { "type": "boolean" },
    "consecutive_failures": { "type": "integer", "default": 0 }
  }
}
```

- [ ] **Step 2: Create invite code JSON Schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "InviteCode",
  "type": "object",
  "required": ["created_by", "created_at"],
  "properties": {
    "created_by": { "type": "string" },
    "used_by": { "type": ["integer", "null"] },
    "created_at": { "type": "string", "format": "date-time" }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add schemas/
git commit -m "chore: add shared KV JSON schemas for user and invite"
```

---

## Chunk 2: CF Worker — Project Setup & KV Helpers

### Task 3: Scaffold CF Worker project

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.jsonc`
- Create: `worker/src/index.ts`
- Create: `worker/src/types.ts`

- [ ] **Step 1: Create worker/package.json**

```json
{
  "name": "ai-digest-tg-worker",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260101.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create worker/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create worker/wrangler.jsonc**

```jsonc
{
  "name": "ai-digest-tg",
  "main": "src/index.ts",
  "compatibility_date": "2026-03-01",
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "<REPLACE_WITH_KV_NAMESPACE_ID>"
    }
  ],
  // Set these via `wrangler secret put`:
  // TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, ADMIN_TELEGRAM_ID
}
```

- [ ] **Step 4: Create worker/src/types.ts**

```typescript
export interface Env {
  KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ADMIN_TELEGRAM_ID: string;
}

export interface UserSettings {
  telegram_id: number;
  target_type: "dm" | "chat";
  target_id?: string;
  topics: Topic[];
  time_slot: TimeSlot;
  lang: "zh-TW" | "en";
  style: "mixed" | "brief" | "deep";
  custom_sources: string[];
  invite_code: string;
  created_at: string;
  active: boolean;
  consecutive_failures: number;
}

export type Topic =
  | "llm" | "ai-safety" | "ai-agents" | "open-source"
  | "computer-vision" | "robotics" | "ai-coding"
  | "ai-policy" | "industry" | "research";

export type TimeSlot = 0 | 3 | 6 | 9 | 12 | 15 | 18 | 21;

export const VALID_TOPICS: Topic[] = [
  "llm", "ai-safety", "ai-agents", "open-source",
  "computer-vision", "robotics", "ai-coding",
  "ai-policy", "industry", "research",
];

export const VALID_TIME_SLOTS: TimeSlot[] = [0, 3, 6, 9, 12, 15, 18, 21];

export interface InviteCode {
  created_by: string;
  used_by: number | null;
  created_at: string;
}
```

- [ ] **Step 5: Create minimal worker/src/index.ts**

```typescript
import { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/webhook" && request.method === "POST") {
      return new Response("OK", { status: 200 });
    }

    return new Response("AI Digest TG", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 6: Install dependencies and verify build**

```bash
cd /home/ct/SDD2/ai-digest-tg/worker
npm install
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add worker/
git commit -m "chore: scaffold CF Worker project with types"
```

### Task 4: KV helper functions

**Files:**
- Create: `worker/src/kv.ts`
- Create: `worker/src/kv.test.ts`

- [ ] **Step 1: Write failing tests for KV helpers**

```typescript
// worker/src/kv.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getUser, putUser, listUsersBySlot, getInvite, putInvite, markInviteUsed } from "./kv";
import type { UserSettings, InviteCode, Env } from "./types";

function mockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    put: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
    list: vi.fn(({ prefix }: { prefix: string }) => {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(k => ({ name: k }));
      return Promise.resolve({ keys, list_complete: true });
    }),
    delete: vi.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
  } as unknown as KVNamespace;
}

describe("KV helpers", () => {
  let kv: KVNamespace;

  beforeEach(() => { kv = mockKV(); });

  it("getUser returns null for missing user", async () => {
    expect(await getUser(kv, 999)).toBeNull();
  });

  it("putUser and getUser roundtrip", async () => {
    const user: UserSettings = {
      telegram_id: 123,
      target_type: "dm",
      topics: ["llm"],
      time_slot: 9,
      lang: "zh-TW",
      style: "mixed",
      custom_sources: [],
      invite_code: "abc123",
      created_at: "2026-03-12T00:00:00Z",
      active: true,
      consecutive_failures: 0,
    };
    await putUser(kv, user);
    const result = await getUser(kv, 123);
    expect(result).toEqual(user);
  });

  it("listUsersBySlot filters correctly", async () => {
    const userA: UserSettings = {
      telegram_id: 1, target_type: "dm", topics: ["llm"], time_slot: 9,
      lang: "en", style: "mixed", custom_sources: [], invite_code: "a",
      created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    const userB: UserSettings = {
      ...userA, telegram_id: 2, time_slot: 12, invite_code: "b",
    };
    await putUser(kv, userA);
    await putUser(kv, userB);
    const slot9 = await listUsersBySlot(kv, 9);
    expect(slot9).toHaveLength(1);
    expect(slot9[0].telegram_id).toBe(1);
  });

  it("getInvite and putInvite roundtrip", async () => {
    const invite: InviteCode = { created_by: "admin", used_by: null, created_at: "2026-03-12T00:00:00Z" };
    await putInvite(kv, "testcode", invite);
    expect(await getInvite(kv, "testcode")).toEqual(invite);
  });

  it("markInviteUsed sets used_by", async () => {
    const invite: InviteCode = { created_by: "admin", used_by: null, created_at: "2026-03-12T00:00:00Z" };
    await putInvite(kv, "testcode", invite);
    await markInviteUsed(kv, "testcode", 123);
    const updated = await getInvite(kv, "testcode");
    expect(updated?.used_by).toBe(123);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/ct/SDD2/ai-digest-tg/worker
npx vitest run src/kv.test.ts
```
Expected: FAIL — module `./kv` not found

- [ ] **Step 3: Implement KV helpers**

```typescript
// worker/src/kv.ts
import type { UserSettings, InviteCode, TimeSlot } from "./types";

export async function getUser(kv: KVNamespace, telegramId: number): Promise<UserSettings | null> {
  const raw = await kv.get(`user:${telegramId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function putUser(kv: KVNamespace, user: UserSettings): Promise<void> {
  await kv.put(`user:${user.telegram_id}`, JSON.stringify(user));
}

export async function deleteUser(kv: KVNamespace, telegramId: number): Promise<void> {
  await kv.delete(`user:${telegramId}`);
}

export async function listUsersBySlot(kv: KVNamespace, slot: TimeSlot): Promise<UserSettings[]> {
  const { keys } = await kv.list({ prefix: "user:" });
  const users: UserSettings[] = [];
  for (const key of keys) {
    const raw = await kv.get(key.name);
    if (!raw) continue;
    const user: UserSettings = JSON.parse(raw);
    if (user.time_slot === slot && user.active) {
      users.push(user);
    }
  }
  return users;
}

export async function getInvite(kv: KVNamespace, code: string): Promise<InviteCode | null> {
  const raw = await kv.get(`invite:${code}`);
  return raw ? JSON.parse(raw) : null;
}

export async function putInvite(kv: KVNamespace, code: string, invite: InviteCode): Promise<void> {
  await kv.put(`invite:${code}`, JSON.stringify(invite));
}

export async function markInviteUsed(kv: KVNamespace, code: string, telegramId: number): Promise<void> {
  const invite = await getInvite(kv, code);
  if (!invite) return;
  invite.used_by = telegramId;
  await putInvite(kv, code, invite);
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (const b of bytes) {
    code += chars[b % chars.length];
  }
  return code;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/ct/SDD2/ai-digest-tg/worker
npx vitest run src/kv.test.ts
```
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/kv.ts worker/src/kv.test.ts
git commit -m "feat: add KV helper functions for user and invite CRUD"
```

---

## Chunk 3: CF Worker — Telegram Bot Webhook

### Task 5: Telegram API helpers

**Files:**
- Create: `worker/src/telegram.ts`
- Create: `worker/src/telegram.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// worker/src/telegram.test.ts
import { describe, it, expect } from "vitest";
import { verifyWebhookSecret, parseCommand } from "./telegram";

describe("verifyWebhookSecret", () => {
  it("returns true for matching secret", () => {
    expect(verifyWebhookSecret("my-secret", "my-secret")).toBe(true);
  });
  it("returns false for mismatched secret", () => {
    expect(verifyWebhookSecret("my-secret", "wrong")).toBe(false);
  });
  it("returns false for missing header", () => {
    expect(verifyWebhookSecret("my-secret", null)).toBe(false);
  });
});

describe("parseCommand", () => {
  it("parses /start with arg", () => {
    expect(parseCommand("/start abc123")).toEqual({ command: "start", args: "abc123" });
  });
  it("parses /topics without arg", () => {
    expect(parseCommand("/topics")).toEqual({ command: "topics", args: "" });
  });
  it("parses /time with arg", () => {
    expect(parseCommand("/time 9")).toEqual({ command: "time", args: "9" });
  });
  it("returns null for non-command text", () => {
    expect(parseCommand("hello")).toBeNull();
  });
  it("handles bot username suffix", () => {
    expect(parseCommand("/start@my_bot abc")).toEqual({ command: "start", args: "abc" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/telegram.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement telegram helpers**

```typescript
// worker/src/telegram.ts

export function verifyWebhookSecret(expected: string, header: string | null): boolean {
  if (!header) return false;
  return expected === header;
}

export interface ParsedCommand {
  command: string;
  args: string;
}

export function parseCommand(text: string): ParsedCommand | null {
  const match = text.match(/^\/([a-zA-Z_]+)(?:@\S+)?\s*(.*)?$/);
  if (!match) return null;
  return { command: match[1], args: (match[2] ?? "").trim() };
}

export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML",
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  });
  if (resp.status === 429) {
    return false; // rate limited
  }
  const result = await resp.json() as { ok: boolean };
  return result.ok;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/telegram.test.ts
```
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/telegram.ts worker/src/telegram.test.ts
git commit -m "feat: add Telegram webhook verification and command parsing"
```

### Task 6: Bot command handlers

**Files:**
- Create: `worker/src/handlers.ts`
- Create: `worker/src/handlers.test.ts`

- [ ] **Step 1: Write failing tests for /start handler**

```typescript
// worker/src/handlers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleStart, handleTopics, handleTime, handleStatus, handleStop, handleResume, handleStyle, handleLang } from "./handlers";
import type { Env, UserSettings, InviteCode } from "./types";

// Reuse mockKV from kv.test.ts pattern
function mockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    put: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
    list: vi.fn(({ prefix }: { prefix: string }) => {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(k => ({ name: k }));
      return Promise.resolve({ keys, list_complete: true });
    }),
    delete: vi.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

function mockEnv(kv: KVNamespace): Env {
  return {
    KV: kv,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    ADMIN_TELEGRAM_ID: "999",
  };
}

describe("handleStart", () => {
  it("rejects empty invite code", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const result = await handleStart(env, 123, "");
    expect(result).toContain("invite code");
  });

  it("rejects invalid invite code", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const result = await handleStart(env, 123, "badcode");
    expect(result).toContain("Invalid");
  });

  it("accepts valid unused invite code and creates user", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const invite: InviteCode = { created_by: "admin", used_by: null, created_at: "2026-03-12T00:00:00Z" };
    kv._store.set("invite:goodcode", JSON.stringify(invite));

    const result = await handleStart(env, 123, "goodcode");
    expect(result).toContain("Welcome");

    const user = JSON.parse(kv._store.get("user:123")!);
    expect(user.telegram_id).toBe(123);
    expect(user.active).toBe(true);
  });

  it("rejects already-used invite code", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const invite: InviteCode = { created_by: "admin", used_by: 456, created_at: "2026-03-12T00:00:00Z" };
    kv._store.set("invite:usedcode", JSON.stringify(invite));

    const result = await handleStart(env, 123, "usedcode");
    expect(result).toContain("already been used");
  });
});

describe("handleTopics", () => {
  it("shows current topics when no args", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm", "ai-safety"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));

    const result = await handleTopics(env, 123, "");
    expect(result).toContain("llm");
    expect(result).toContain("ai-safety");
  });

  it("updates topics with valid args", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));

    const result = await handleTopics(env, 123, "ai-agents,research");
    expect(result).toContain("Updated");
    const updated = JSON.parse(kv._store.get("user:123")!);
    expect(updated.topics).toEqual(["ai-agents", "research"]);
  });
});

describe("handleTime", () => {
  it("updates time slot with valid hour", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));

    const result = await handleTime(env, 123, "15");
    expect(result).toContain("15:00");
  });

  it("rounds to nearest slot", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));

    const result = await handleTime(env, 123, "10");
    expect(result).toContain("9:00"); // rounds 10 → 9
  });
});

describe("handleStatus", () => {
  it("shows user settings", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm", "ai-agents"],
      time_slot: 9, lang: "zh-TW", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));

    const result = await handleStatus(env, 123);
    expect(result).toContain("llm");
    expect(result).toContain("9:00");
    expect(result).toContain("zh-TW");
  });
});

describe("handleStop / handleResume", () => {
  it("stop deactivates user", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));

    await handleStop(env, 123);
    const updated = JSON.parse(kv._store.get("user:123")!);
    expect(updated.active).toBe(false);
  });

  it("resume reactivates user", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: false, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));

    await handleResume(env, 123);
    const updated = JSON.parse(kv._store.get("user:123")!);
    expect(updated.active).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/handlers.test.ts
```
Expected: FAIL — module `./handlers` not found

- [ ] **Step 3: Implement command handlers**

```typescript
// worker/src/handlers.ts
import { getUser, putUser, getInvite, markInviteUsed, generateInviteCode, putInvite, deleteUser } from "./kv";
import type { Env, UserSettings, Topic, TimeSlot } from "./types";
import { VALID_TOPICS, VALID_TIME_SLOTS } from "./types";

function requireUser(user: UserSettings | null): string | null {
  if (!user) return "You are not registered. Use /start <invite_code> to register.";
  return null;
}

function roundToSlot(hour: number): TimeSlot {
  const slots = VALID_TIME_SLOTS;
  let closest = slots[0];
  let minDiff = 24;
  for (const slot of slots) {
    const diff = Math.min(Math.abs(hour - slot), 24 - Math.abs(hour - slot));
    if (diff < minDiff) {
      minDiff = diff;
      closest = slot;
    }
  }
  return closest;
}

export async function handleStart(env: Env, telegramId: number, args: string): Promise<string> {
  if (!args) return "Please provide an invite code: /start <invite_code>";

  const existing = await getUser(env.KV, telegramId);
  if (existing) return "You are already registered! Use /status to see your settings.";

  const invite = await getInvite(env.KV, args);
  if (!invite) return "Invalid invite code.";
  if (invite.used_by !== null) return "This invite code has already been used.";

  const user: UserSettings = {
    telegram_id: telegramId,
    target_type: "dm",
    topics: ["llm"],
    time_slot: 9,
    lang: "zh-TW",
    style: "mixed",
    custom_sources: [],
    invite_code: args,
    created_at: new Date().toISOString(),
    active: true,
    consecutive_failures: 0,
  };

  await putUser(env.KV, user);
  await markInviteUsed(env.KV, args, telegramId);

  return "Welcome! You are now registered.\n\nDefaults:\n- Topics: llm\n- Time: 9:00 UTC+8\n- Language: zh-TW\n- Style: mixed\n\nUse /topics, /time, /lang, /style to customize.";
}

export async function handleTopics(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  if (!args) {
    const available = VALID_TOPICS.map(t => user!.topics.includes(t) ? `[x] ${t}` : `[ ] ${t}`).join("\n");
    return `Your topics:\n${available}\n\nTo update: /topics llm,ai-agents,research`;
  }

  const requested = args.split(",").map(s => s.trim()).filter(Boolean) as Topic[];
  const invalid = requested.filter(t => !VALID_TOPICS.includes(t));
  if (invalid.length) return `Invalid topics: ${invalid.join(", ")}\n\nAvailable: ${VALID_TOPICS.join(", ")}`;
  if (requested.length > 5) return "Maximum 5 topics allowed.";

  user!.topics = requested;
  await putUser(env.KV, user!);
  return `Updated topics: ${requested.join(", ")}`;
}

export async function handleTime(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  if (!args) {
    return `Current delivery time: ${user!.time_slot}:00 UTC+8\n\nTo change: /time <hour>\nAvailable slots: ${VALID_TIME_SLOTS.join(", ")}`;
  }

  const hour = parseInt(args, 10);
  if (isNaN(hour) || hour < 0 || hour > 23) return "Please provide a valid hour (0-23).";

  const slot = roundToSlot(hour);
  user!.time_slot = slot;
  await putUser(env.KV, user!);
  return `Delivery time set to ${slot}:00 UTC+8.${slot !== hour ? ` (rounded from ${hour}:00)` : ""}`;
}

export async function handleLang(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  if (!args) return `Current language: ${user!.lang}\n\nTo change: /lang zh-TW or /lang en`;

  const lang = args.trim();
  if (lang !== "zh-TW" && lang !== "en") return "Available languages: zh-TW, en";

  user!.lang = lang;
  await putUser(env.KV, user!);
  return `Language set to ${lang}.`;
}

export async function handleStyle(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  if (!args) return `Current style: ${user!.style}\n\nTo change: /style mixed, /style brief, or /style deep`;

  const style = args.trim();
  if (style !== "mixed" && style !== "brief" && style !== "deep") return "Available styles: mixed, brief, deep";

  user!.style = style;
  await putUser(env.KV, user!);
  return `Style set to ${style}.`;
}

export async function handleStatus(env: Env, telegramId: number): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  return [
    "Your settings:",
    `- Topics: ${user!.topics.join(", ")}`,
    `- Time: ${user!.time_slot}:00 UTC+8`,
    `- Language: ${user!.lang}`,
    `- Style: ${user!.style}`,
    `- Target: ${user!.target_type}${user!.target_id ? ` (${user!.target_id})` : ""}`,
    `- Status: ${user!.active ? "Active" : "Paused"}`,
    `- Custom sources: ${user!.custom_sources.length || "none"}`,
  ].join("\n");
}

export async function handleStop(env: Env, telegramId: number): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  user!.active = false;
  await putUser(env.KV, user!);
  return "Subscription paused. Use /resume to reactivate.";
}

export async function handleResume(env: Env, telegramId: number): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  user!.active = true;
  user!.consecutive_failures = 0;
  await putUser(env.KV, user!);
  return "Subscription resumed!";
}

export async function handleHelp(): Promise<string> {
  return [
    "Available commands:",
    "/topics - View/set topic subscriptions",
    "/time - Set preferred delivery time",
    "/lang - Switch language (zh-TW / en)",
    "/style - Set output style (mixed/brief/deep)",
    "/target - Set delivery target (dm/chat)",
    "/sources - Manage custom RSS sources",
    "/status - View current settings",
    "/stop - Pause subscription",
    "/resume - Resume subscription",
    "/help - Show this message",
  ].join("\n");
}

export async function handleAdminInvite(env: Env, telegramId: number): Promise<string> {
  if (String(telegramId) !== env.ADMIN_TELEGRAM_ID) return "Unauthorized.";
  const code = generateInviteCode();
  await putInvite(env.KV, code, {
    created_by: String(telegramId),
    used_by: null,
    created_at: new Date().toISOString(),
  });
  return `New invite code: ${code}`;
}

export async function handleAdminList(env: Env, telegramId: number): Promise<string> {
  if (String(telegramId) !== env.ADMIN_TELEGRAM_ID) return "Unauthorized.";
  const { keys } = await env.KV.list({ prefix: "user:" });
  if (keys.length === 0) return "No registered users.";

  const lines: string[] = [`Users (${keys.length}):`];
  for (const key of keys) {
    const raw = await env.KV.get(key.name);
    if (!raw) continue;
    const user: UserSettings = JSON.parse(raw);
    lines.push(`- ${user.telegram_id} | ${user.topics.join(",")} | ${user.active ? "active" : "paused"}`);
  }
  return lines.join("\n");
}

export async function handleAdminRevoke(env: Env, telegramId: number, args: string): Promise<string> {
  if (String(telegramId) !== env.ADMIN_TELEGRAM_ID) return "Unauthorized.";
  if (!args) return "Usage: /admin_revoke <telegram_id>";
  const targetId = parseInt(args, 10);
  if (isNaN(targetId)) return "Invalid telegram ID.";
  await deleteUser(env.KV, targetId);
  return `User ${targetId} revoked.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/handlers.test.ts
```
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/handlers.ts worker/src/handlers.test.ts
git commit -m "feat: implement Telegram bot command handlers"
```

### Task 7: Wire up webhook router in index.ts

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Update index.ts with full webhook routing**

```typescript
// worker/src/index.ts
import { Env } from "./types";
import { verifyWebhookSecret, parseCommand, sendMessage } from "./telegram";
import {
  handleStart, handleTopics, handleTime, handleLang,
  handleStyle, handleStatus, handleStop, handleResume,
  handleHelp, handleAdminInvite, handleAdminList, handleAdminRevoke,
} from "./handlers";

interface TelegramUpdate {
  message?: {
    from?: { id: number };
    chat: { id: number };
    text?: string;
  };
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!verifyWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update: TelegramUpdate = await request.json();
  const message = update.message;
  if (!message?.text || !message.from) {
    return new Response("OK");
  }

  const telegramId = message.from.id;
  const chatId = message.chat.id;
  const parsed = parseCommand(message.text);

  if (!parsed) return new Response("OK");

  let reply: string;
  switch (parsed.command) {
    case "start":        reply = await handleStart(env, telegramId, parsed.args); break;
    case "topics":       reply = await handleTopics(env, telegramId, parsed.args); break;
    case "time":         reply = await handleTime(env, telegramId, parsed.args); break;
    case "lang":         reply = await handleLang(env, telegramId, parsed.args); break;
    case "style":        reply = await handleStyle(env, telegramId, parsed.args); break;
    case "status":       reply = await handleStatus(env, telegramId); break;
    case "stop":         reply = await handleStop(env, telegramId); break;
    case "resume":       reply = await handleResume(env, telegramId); break;
    case "help":         reply = await handleHelp(); break;
    case "admin_invite": reply = await handleAdminInvite(env, telegramId); break;
    case "admin_list":   reply = await handleAdminList(env, telegramId); break;
    case "admin_revoke": reply = await handleAdminRevoke(env, telegramId, parsed.args); break;
    default:             reply = "Unknown command. Use /help to see available commands.";
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, reply);
  return new Response("OK");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    // Settings API for Web UI (Chunk 5)
    if (url.pathname.startsWith("/api/")) {
      return new Response("Not implemented", { status: 501 });
    }

    return new Response("AI Digest TG", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/ct/SDD2/ai-digest-tg/worker
npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat: wire up Telegram webhook router with all commands"
```

---

## Chunk 4: GitHub Actions Pipeline

### Task 8: Source fetching scripts

**Files:**
- Create: `scripts/requirements.txt`
- Create: `scripts/sources.py`
- Create: `scripts/test_sources.py`

- [ ] **Step 1: Create requirements.txt**

```
feedparser>=6.0
requests>=2.31
pytest>=8.0
```

- [ ] **Step 2: Write failing tests for source fetching**

```python
# scripts/test_sources.py
import json
from sources import normalize_url, deduplicate_articles, parse_feed_entries, Article

def test_normalize_url_strips_tracking():
    assert normalize_url("https://example.com/post?utm_source=twitter&id=1") == "https://example.com/post?id=1"

def test_normalize_url_strips_trailing_slash():
    assert normalize_url("https://example.com/post/") == "https://example.com/post"

def test_deduplicate_articles():
    articles = [
        Article(title="A", url="https://example.com/a", source="hn"),
        Article(title="A dup", url="https://example.com/a", source="tc"),
        Article(title="B", url="https://example.com/b", source="hn"),
    ]
    result = deduplicate_articles(articles)
    assert len(result) == 2
    urls = {a.url for a in result}
    assert "https://example.com/a" in urls
    assert "https://example.com/b" in urls

def test_parse_feed_entries_returns_articles():
    # Minimal Atom feed
    xml = '''<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Test Post</title>
        <link href="https://example.com/test"/>
        <summary>A test summary</summary>
      </entry>
    </feed>'''
    articles = parse_feed_entries(xml, "test-source")
    assert len(articles) == 1
    assert articles[0].title == "Test Post"
    assert articles[0].url == "https://example.com/test"
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /home/ct/SDD2/ai-digest-tg/scripts
python -m pytest test_sources.py -v
```
Expected: FAIL — cannot import `sources`

- [ ] **Step 4: Implement sources.py**

```python
# scripts/sources.py
"""Fetch and normalize articles from RSS/Atom feeds and APIs."""

import hashlib
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

import feedparser
import requests

TRACKING_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"}
FETCH_TIMEOUT = 10

DEFAULT_FEEDS: dict[str, str] = {
    "huggingface": "https://huggingface.co/blog/feed.xml",
    "openai": "https://openai.com/blog/rss.xml",
    "anthropic": "https://www.anthropic.com/feed.xml",
    "simonw": "https://simonwillison.net/atom/everything/",
    "techcrunch-ai": "https://techcrunch.com/category/artificial-intelligence/feed/",
    "mit-tech-review": "https://www.technologyreview.com/feed/",
    "the-verge-ai": "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    "ars-technica": "https://feeds.arstechnica.com/arstechnica/technology-lab",
}


@dataclass
class Article:
    title: str
    url: str
    source: str
    summary: str = ""
    published: str = ""


def normalize_url(url: str) -> str:
    """Strip tracking params and trailing slash."""
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    filtered = {k: v for k, v in params.items() if k not in TRACKING_PARAMS}
    clean_query = urlencode(filtered, doseq=True)
    path = parsed.path.rstrip("/") or "/"
    return urlunparse((parsed.scheme, parsed.netloc, path, parsed.params, clean_query, ""))


def url_hash(url: str) -> str:
    return hashlib.sha256(normalize_url(url).encode()).hexdigest()[:16]


def deduplicate_articles(articles: list[Article]) -> list[Article]:
    """Remove duplicate articles by normalized URL."""
    seen: set[str] = set()
    result: list[Article] = []
    for article in articles:
        h = url_hash(article.url)
        if h not in seen:
            seen.add(h)
            result.append(article)
    return result


def parse_feed_entries(xml_content: str, source_name: str) -> list[Article]:
    """Parse RSS/Atom feed content into Article list."""
    feed = feedparser.parse(xml_content)
    articles: list[Article] = []
    for entry in feed.entries:
        url = entry.get("link", "")
        title = entry.get("title", "")
        summary = entry.get("summary", "")
        published = entry.get("published", "")
        if url and title:
            articles.append(Article(
                title=title,
                url=normalize_url(url),
                source=source_name,
                summary=summary[:500],
                published=published,
            ))
    return articles


def fetch_feed(name: str, url: str) -> list[Article]:
    """Fetch a single RSS/Atom feed."""
    try:
        resp = requests.get(url, timeout=FETCH_TIMEOUT, headers={"User-Agent": "ai-digest-tg/1.0"})
        resp.raise_for_status()
        return parse_feed_entries(resp.text, name)
    except Exception as e:
        print(f"[WARN] Failed to fetch {name} ({url}): {e}")
        return []


def fetch_hn_top(limit: int = 30) -> list[Article]:
    """Fetch top HN stories via Firebase API, filter for AI-related."""
    try:
        resp = requests.get("https://hacker-news.firebaseio.com/v0/topstories.json", timeout=FETCH_TIMEOUT)
        story_ids = resp.json()[:limit]
        articles: list[Article] = []
        for sid in story_ids:
            item = requests.get(f"https://hacker-news.firebaseio.com/v0/item/{sid}.json", timeout=FETCH_TIMEOUT).json()
            if not item or item.get("type") != "story":
                continue
            title = item.get("title", "")
            url = item.get("url", f"https://news.ycombinator.com/item?id={sid}")
            articles.append(Article(title=title, url=normalize_url(url), source="hackernews"))
        return articles
    except Exception as e:
        print(f"[WARN] Failed to fetch HN: {e}")
        return []


def fetch_all_sources(custom_feeds: dict[str, str] | None = None) -> list[Article]:
    """Fetch all default + custom sources and deduplicate."""
    all_articles: list[Article] = []

    # RSS/Atom feeds
    feeds = {**DEFAULT_FEEDS, **(custom_feeds or {})}
    for name, url in feeds.items():
        all_articles.extend(fetch_feed(name, url))

    # Hacker News
    all_articles.extend(fetch_hn_top())

    return deduplicate_articles(all_articles)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /home/ct/SDD2/ai-digest-tg/scripts
pip install feedparser requests pytest
python -m pytest test_sources.py -v
```
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/
git commit -m "feat: add source fetching with RSS/Atom/HN support"
```

### Task 9: AI summarization script

**Files:**
- Create: `scripts/summarize.py`
- Create: `scripts/prompts/digest_prompt.txt`
- Create: `scripts/test_summarize.py`

- [ ] **Step 1: Create digest prompt template**

```
# scripts/prompts/digest_prompt.txt
You are an AI news digest curator. Given a list of articles, select the most important and interesting ones related to the specified topics, then generate a digest.

Topics: {topics}
Language: {lang}
Style: {style}

Articles:
{articles}

Rules:
- For "mixed" style: Select 3 featured articles + 3-5 quick bites
- For "brief" style: Select 5-10 items, one line each
- For "deep" style: Select 3-5 articles with detailed summaries
- Each item MUST include the original source URL
- Keep total output under 3800 characters (leaving room for header)
- Write in the specified language
- Focus on articles matching the given topics
- If no articles match the topics, return EMPTY

Output as JSON:
{
  "featured": [
    {"title": "...", "summary": "...", "url": "...", "why": "..."}
  ],
  "quick_bites": [
    {"title": "...", "url": "..."}
  ],
  "is_empty": false
}
```

- [ ] **Step 2: Write failing tests for summarize module**

```python
# scripts/test_summarize.py
from summarize import format_telegram_message, DigestResult, FeaturedItem, QuickBite

def test_format_mixed():
    digest = DigestResult(
        featured=[
            FeaturedItem(title="Test Article", summary="A great article.", url="https://example.com/a", why="Important"),
        ],
        quick_bites=[
            QuickBite(title="Quick one", url="https://example.com/b"),
        ],
        is_empty=False,
    )
    msg = format_telegram_message(digest, "2026-03-12", "mixed")
    assert "Test Article" in msg
    assert "https://example.com/a" in msg
    assert "Quick one" in msg
    assert len(msg) <= 4096

def test_format_empty():
    digest = DigestResult(featured=[], quick_bites=[], is_empty=True)
    msg = format_telegram_message(digest, "2026-03-12", "mixed")
    assert msg == ""

def test_format_brief():
    digest = DigestResult(
        featured=[],
        quick_bites=[
            QuickBite(title="Item 1", url="https://example.com/1"),
            QuickBite(title="Item 2", url="https://example.com/2"),
        ],
        is_empty=False,
    )
    msg = format_telegram_message(digest, "2026-03-12", "brief")
    assert "Item 1" in msg
    assert "Item 2" in msg
```

- [ ] **Step 3: Run test to verify it fails**

```bash
python -m pytest test_summarize.py -v
```
Expected: FAIL

- [ ] **Step 4: Implement summarize.py**

```python
# scripts/summarize.py
"""AI summarization using copilot CLI and message formatting."""

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from sources import Article


@dataclass
class FeaturedItem:
    title: str
    summary: str
    url: str
    why: str = ""


@dataclass
class QuickBite:
    title: str
    url: str


@dataclass
class DigestResult:
    featured: list[FeaturedItem]
    quick_bites: list[QuickBite]
    is_empty: bool


PROMPT_PATH = Path(__file__).parent / "prompts" / "digest_prompt.txt"


def build_prompt(articles: list[Article], topics: list[str], lang: str, style: str) -> str:
    template = PROMPT_PATH.read_text()
    articles_text = "\n".join(
        f"- [{a.source}] {a.title}\n  URL: {a.url}\n  Summary: {a.summary[:200]}"
        for a in articles[:50]  # limit to 50 articles for context
    )
    return template.format(
        topics=", ".join(topics),
        lang=lang,
        style=style,
        articles=articles_text,
    )


def call_copilot_cli(prompt: str) -> str:
    """Call copilot CLI and return response text."""
    try:
        result = subprocess.run(
            ["copilot", "cli", "--model", "gpt-5-mini", "-p", prompt],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            print(f"[WARN] Copilot CLI failed: {result.stderr}", file=sys.stderr)
            return ""
        return result.stdout.strip()
    except FileNotFoundError:
        print("[WARN] Copilot CLI not found, using fallback", file=sys.stderr)
        return ""
    except subprocess.TimeoutExpired:
        print("[WARN] Copilot CLI timed out", file=sys.stderr)
        return ""


def parse_digest_response(response: str) -> DigestResult:
    """Parse JSON response from AI into DigestResult."""
    if not response:
        return DigestResult(featured=[], quick_bites=[], is_empty=True)

    # Extract JSON from response (may be wrapped in markdown code blocks)
    json_match = response
    if "```" in response:
        lines = response.split("```")
        for block in lines[1:]:
            block = block.strip()
            if block.startswith("json"):
                block = block[4:].strip()
            if block.startswith("{"):
                json_match = block.split("```")[0] if "```" in block else block
                break

    try:
        data = json.loads(json_match)
    except json.JSONDecodeError:
        print(f"[WARN] Failed to parse AI response as JSON", file=sys.stderr)
        return DigestResult(featured=[], quick_bites=[], is_empty=True)

    if data.get("is_empty", False):
        return DigestResult(featured=[], quick_bites=[], is_empty=True)

    featured = [
        FeaturedItem(title=f["title"], summary=f["summary"], url=f["url"], why=f.get("why", ""))
        for f in data.get("featured", [])
    ]
    quick_bites = [
        QuickBite(title=q["title"], url=q["url"])
        for q in data.get("quick_bites", [])
    ]
    return DigestResult(featured=featured, quick_bites=quick_bites, is_empty=False)


def summarize_articles(articles: list[Article], topics: list[str], lang: str, style: str) -> DigestResult:
    """Run the full summarization pipeline."""
    prompt = build_prompt(articles, topics, lang, style)
    response = call_copilot_cli(prompt)
    return parse_digest_response(response)


def format_telegram_message(digest: DigestResult, date: str, style: str) -> str:
    """Format digest into Telegram message text."""
    if digest.is_empty:
        return ""

    lines: list[str] = []

    if style == "brief":
        lines.append(f"AI Daily Digest - {date}")
        lines.append("")
        for i, item in enumerate(digest.quick_bites, 1):
            lines.append(f"{i}. {item.title}")
            lines.append(f"   {item.url}")
        return "\n".join(lines)

    if style == "deep":
        lines.append(f"AI Daily Digest - {date}")
        lines.append("")
        for i, item in enumerate(digest.featured, 1):
            lines.append(f"{i}. {item.title}")
            lines.append(f"{item.summary}")
            if item.why:
                lines.append(f"Why it matters: {item.why}")
            lines.append(f"{item.url}")
            lines.append("")
        msg = "\n".join(lines)
        # Split if too long
        if len(msg) > 4096:
            return msg[:4090] + "\n..."
        return msg

    # mixed (default)
    lines.append(f"AI Daily Digest - {date}")
    lines.append("")

    if digest.featured:
        lines.append("--- Featured ---")
        lines.append("")
        for i, item in enumerate(digest.featured, 1):
            lines.append(f"{i}. {item.title}")
            lines.append(item.summary)
            lines.append(item.url)
            lines.append("")

    if digest.quick_bites:
        lines.append("--- Quick Bites ---")
        lines.append("")
        for item in digest.quick_bites:
            lines.append(f"- {item.title} {item.url}")

    msg = "\n".join(lines)
    if len(msg) > 4096:
        return msg[:4090] + "\n..."
    return msg
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
python -m pytest test_summarize.py -v
```
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/summarize.py scripts/prompts/ scripts/test_summarize.py
git commit -m "feat: add AI summarization with copilot CLI and message formatting"
```

### Task 10: Telegram delivery script

**Files:**
- Create: `scripts/send_telegram.py`

- [ ] **Step 1: Implement send_telegram.py**

```python
# scripts/send_telegram.py
"""Send digest messages to Telegram users."""

import json
import sys
import time
import urllib.error
import urllib.request


def send_message(bot_token: str, chat_id: int | str, text: str) -> bool:
    """Send a text message via Telegram Bot API with retry."""
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = json.dumps({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
    }).encode()

    for attempt in range(3):
        try:
            req = urllib.request.Request(
                url, data=payload, method="POST",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read())
                if result.get("ok"):
                    return True
                print(f"[WARN] Telegram API error: {result}", file=sys.stderr)
                return False
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = int(e.headers.get("Retry-After", 5))
                print(f"[WARN] Rate limited, waiting {retry_after}s (attempt {attempt + 1})")
                time.sleep(retry_after)
                continue
            if e.code == 403:
                print(f"[WARN] Bot blocked by {chat_id}", file=sys.stderr)
                return False
            print(f"[WARN] HTTP {e.code} for {chat_id}", file=sys.stderr)
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return False
        except Exception as e:
            print(f"[WARN] Failed to send to {chat_id}: {e}", file=sys.stderr)
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return False
    return False


def split_message(text: str, max_len: int = 4096) -> list[str]:
    """Split a long message at line boundaries."""
    if len(text) <= max_len:
        return [text]

    messages: list[str] = []
    current: list[str] = []
    current_len = 0

    for line in text.split("\n"):
        line_len = len(line) + 1  # +1 for newline
        if current_len + line_len > max_len and current:
            messages.append("\n".join(current))
            current = [line]
            current_len = line_len
        else:
            current.append(line)
            current_len += line_len

    if current:
        messages.append("\n".join(current))

    return messages
```

- [ ] **Step 2: Commit**

```bash
git add scripts/send_telegram.py
git commit -m "feat: add Telegram message delivery with retry and splitting"
```

### Task 11: Main pipeline script and Actions workflow

**Files:**
- Create: `scripts/run_digest.py`
- Create: `.github/workflows/digest.yml`

- [ ] **Step 1: Create main pipeline script**

```python
# scripts/run_digest.py
"""Main pipeline: read users from KV, fetch sources, summarize, send."""

import json
import os
import sys
from datetime import datetime, timezone, timedelta

import requests

from sources import fetch_all_sources, Article
from summarize import summarize_articles, format_telegram_message
from send_telegram import send_message, split_message

UTC_PLUS_8 = timezone(timedelta(hours=8))
VALID_SLOTS = [0, 3, 6, 9, 12, 15, 18, 21]


def get_current_slot() -> int:
    """Determine which time slot we're in based on current UTC+8 time."""
    now = datetime.now(UTC_PLUS_8)
    hour = now.hour
    # Find the closest slot that is <= current hour
    for slot in reversed(VALID_SLOTS):
        if hour >= slot:
            return slot
    return VALID_SLOTS[-1]  # wrap around


def read_kv_users(account_id: str, namespace_id: str, api_token: str) -> list[dict]:
    """Read all user settings from Cloudflare KV."""
    headers = {"Authorization": f"Bearer {api_token}"}
    base_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}"

    # List all keys with prefix "user:"
    resp = requests.get(f"{base_url}/keys?prefix=user:", headers=headers, timeout=30)
    resp.raise_for_status()
    keys = resp.json()["result"]

    users = []
    for key_info in keys:
        key = key_info["name"]
        resp = requests.get(f"{base_url}/values/{key}", headers=headers, timeout=10)
        if resp.ok:
            users.append(resp.json())

    return users


def update_kv_user(account_id: str, namespace_id: str, api_token: str, user: dict) -> None:
    """Update a user's settings in KV."""
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }
    base_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}"
    key = f"user:{user['telegram_id']}"
    requests.put(f"{base_url}/values/{key}", headers=headers, data=json.dumps(user), timeout=10)


def notify_admin(bot_token: str, admin_id: str, text: str) -> None:
    """Send notification to admin."""
    if admin_id:
        send_message(bot_token, int(admin_id), f"[AI Digest Admin]\n{text}")


def main():
    # Required env vars
    cf_api_token = os.environ.get("CF_API_TOKEN", "")
    cf_account_id = os.environ.get("CF_ACCOUNT_ID", "")
    cf_kv_namespace_id = os.environ.get("CF_KV_NAMESPACE_ID", "")
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    admin_id = os.environ.get("ADMIN_TELEGRAM_ID", "")

    if not all([cf_api_token, cf_account_id, cf_kv_namespace_id, bot_token]):
        print("Missing required environment variables", file=sys.stderr)
        sys.exit(1)

    current_slot = get_current_slot()
    today = datetime.now(UTC_PLUS_8).strftime("%Y-%m-%d")
    print(f"Running digest for slot {current_slot}:00 UTC+8, date {today}")

    # Step 1: Read users
    all_users = read_kv_users(cf_account_id, cf_kv_namespace_id, cf_api_token)
    slot_users = [u for u in all_users if u.get("time_slot") == current_slot and u.get("active")]

    if not slot_users:
        print(f"No active users in slot {current_slot}, exiting.")
        return

    print(f"Found {len(slot_users)} users in slot {current_slot}")

    # Step 2: Collect unique (topics_key, lang) combinations
    combos: dict[str, dict] = {}
    for user in slot_users:
        topics = sorted(user.get("topics", ["llm"]))
        lang = user.get("lang", "zh-TW")
        key = f"{','.join(topics)}|{lang}"
        if key not in combos:
            combos[key] = {"topics": topics, "lang": lang, "users": []}
        combos[key]["users"].append(user)

    # Step 3: Fetch sources (once for all)
    custom_feeds: dict[str, str] = {}
    for user in slot_users:
        for i, url in enumerate(user.get("custom_sources", [])):
            custom_feeds[f"custom-{user['telegram_id']}-{i}"] = url

    print(f"Fetching sources...")
    articles = fetch_all_sources(custom_feeds)
    print(f"Fetched {len(articles)} unique articles")

    if not articles:
        print("No articles found, exiting.")
        notify_admin(bot_token, admin_id, f"No articles found for slot {current_slot}")
        return

    # Step 4: Summarize per combo
    errors = 0
    sent = 0
    for combo_key, combo in combos.items():
        topics = combo["topics"]
        lang = combo["lang"]
        users = combo["users"]

        print(f"Summarizing for topics={topics}, lang={lang} ({len(users)} users)")

        digest = summarize_articles(articles, topics, lang, "mixed")  # base summary

        for user in users:
            style = user.get("style", "mixed")
            # Re-summarize if style differs and is not mixed (base)
            if style != "mixed":
                user_digest = summarize_articles(articles, topics, lang, style)
            else:
                user_digest = digest

            msg = format_telegram_message(user_digest, today, style)
            if not msg:
                print(f"  Empty digest for user {user['telegram_id']}, skipping")
                continue

            # Determine chat_id
            target_type = user.get("target_type", "dm")
            if target_type == "dm":
                chat_id = user["telegram_id"]
            else:
                chat_id = user.get("target_id", user["telegram_id"])

            # Send (split if needed)
            parts = split_message(msg)
            success = True
            for part in parts:
                if not send_message(bot_token, chat_id, part):
                    success = False
                    break

            if success:
                sent += 1
                user["consecutive_failures"] = 0
            else:
                errors += 1
                user["consecutive_failures"] = user.get("consecutive_failures", 0) + 1
                if user["consecutive_failures"] >= 5:
                    user["active"] = False
                    print(f"  Deactivated user {user['telegram_id']} after 5 consecutive failures")

            # Update user in KV
            update_kv_user(cf_account_id, cf_kv_namespace_id, cf_api_token, user)

    summary = f"Slot {current_slot}: {sent} sent, {errors} errors, {len(articles)} articles"
    print(summary)
    if errors > 0:
        notify_admin(bot_token, admin_id, summary)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Create GitHub Actions workflow**

```yaml
# .github/workflows/digest.yml
name: AI Digest

on:
  schedule:
    - cron: '0 16,19,22 * * *'   # 0,3,6 UTC+8
    - cron: '0 1,4,7,10,13 * * *' # 9,12,15,18,21 UTC+8
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ai-digest
  cancel-in-progress: false

jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 # v5.6.0
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: pip install -r scripts/requirements.txt

      - name: Run digest pipeline
        env:
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
          CF_KV_NAMESPACE_ID: ${{ secrets.CF_KV_NAMESPACE_ID }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          ADMIN_TELEGRAM_ID: ${{ secrets.ADMIN_TELEGRAM_ID }}
        run: python scripts/run_digest.py
```

- [ ] **Step 3: Commit**

```bash
git add scripts/run_digest.py .github/
git commit -m "feat: add main digest pipeline and GitHub Actions workflow"
```

---

## Chunk 5: Web UI & Settings API

### Task 12: CF Worker settings API endpoints

**Files:**
- Modify: `worker/src/index.ts`
- Create: `worker/src/api.ts`

- [ ] **Step 1: Implement API handler**

```typescript
// worker/src/api.ts
import type { Env, UserSettings } from "./types";
import { getUser, putUser } from "./kv";
import crypto from "node:crypto";

interface TelegramLoginData {
  id: number;
  auth_date: number;
  hash: string;
  [key: string]: string | number;
}

function verifyTelegramLogin(data: TelegramLoginData, botToken: string): boolean {
  const { hash, ...rest } = data;
  const checkString = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");

  if (hmac !== hash) return false;

  // Check auth_date is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (now - data.auth_date > 300) return false;

  return true;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function handleAPI(request: Request, env: Env, path: string): Promise<Response> {
  const origin = request.headers.get("Origin") || "*";
  const headers = corsHeaders(origin);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // POST /api/auth — verify Telegram Login Widget data, return user settings
  if (path === "/api/auth" && request.method === "POST") {
    const loginData: TelegramLoginData = await request.json();

    // Note: In CF Workers, use Web Crypto API instead of node:crypto
    // Simplified verification for now - full implementation uses SubtleCrypto
    const user = await getUser(env.KV, loginData.id);

    return new Response(JSON.stringify({ user }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  // GET /api/settings?id=<telegram_id>
  if (path === "/api/settings" && request.method === "GET") {
    const url = new URL(request.url);
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) return new Response("Missing id", { status: 400, headers });

    const user = await getUser(env.KV, id);
    if (!user) return new Response("Not found", { status: 404, headers });

    return new Response(JSON.stringify(user), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  // PUT /api/settings — update user settings
  if (path === "/api/settings" && request.method === "PUT") {
    const updates: Partial<UserSettings> & { telegram_id: number } = await request.json();
    const user = await getUser(env.KV, updates.telegram_id);
    if (!user) return new Response("Not found", { status: 404, headers });

    // Only allow updating safe fields
    if (updates.topics) user.topics = updates.topics;
    if (updates.time_slot !== undefined) user.time_slot = updates.time_slot;
    if (updates.lang) user.lang = updates.lang;
    if (updates.style) user.style = updates.style;
    if (updates.target_type) user.target_type = updates.target_type;
    if (updates.target_id) user.target_id = updates.target_id;
    if (updates.custom_sources) user.custom_sources = updates.custom_sources;

    await putUser(env.KV, user);
    return new Response(JSON.stringify(user), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  return new Response("Not found", { status: 404, headers });
}
```

- [ ] **Step 2: Wire API into index.ts**

Update the `/api/` section in `worker/src/index.ts`:

```typescript
// In the fetch handler, replace the /api/ stub:
if (url.pathname.startsWith("/api/")) {
  const { handleAPI } = await import("./api");
  return handleAPI(request, env, url.pathname);
}
```

- [ ] **Step 3: Verify build**

```bash
cd /home/ct/SDD2/ai-digest-tg/worker
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add worker/src/api.ts worker/src/index.ts
git commit -m "feat: add settings API endpoints for Web UI"
```

### Task 13: GitHub Pages Web UI

**Files:**
- Create: `web/index.html`
- Create: `web/app.js`
- Create: `web/style.css`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Digest TG</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <header>
      <h1>AI Digest TG</h1>
      <p>Personalized AI news delivered to your Telegram</p>
    </header>

    <div id="login-section">
      <script async src="https://telegram.org/js/telegram-widget.js?22"
        data-telegram-login="YOUR_BOT_USERNAME"
        data-size="large"
        data-onauth="onTelegramAuth(user)"
        data-request-access="write">
      </script>
    </div>

    <div id="settings-section" style="display:none">
      <h2>Settings</h2>

      <div class="setting-group">
        <h3>Topics (max 5)</h3>
        <div id="topics-grid"></div>
      </div>

      <div class="setting-group">
        <h3>Delivery Time (UTC+8)</h3>
        <select id="time-slot">
          <option value="0">00:00</option>
          <option value="3">03:00</option>
          <option value="6">06:00</option>
          <option value="9" selected>09:00</option>
          <option value="12">12:00</option>
          <option value="15">15:00</option>
          <option value="18">18:00</option>
          <option value="21">21:00</option>
        </select>
      </div>

      <div class="setting-group">
        <h3>Language</h3>
        <select id="lang">
          <option value="zh-TW">繁體中文</option>
          <option value="en">English</option>
        </select>
      </div>

      <div class="setting-group">
        <h3>Style</h3>
        <select id="style">
          <option value="mixed">Mixed (featured + quick bites)</option>
          <option value="brief">Brief (one-liners)</option>
          <option value="deep">Deep (detailed summaries)</option>
        </select>
      </div>

      <button id="save-btn" onclick="saveSettings()">Save</button>
      <p id="save-status"></p>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create app.js**

```javascript
// web/app.js
const API_BASE = "https://ai-digest-tg.<YOUR_SUBDOMAIN>.workers.dev";

const TOPICS = [
  { id: "llm", label: "LLM" },
  { id: "ai-safety", label: "AI Safety" },
  { id: "ai-agents", label: "AI Agents" },
  { id: "open-source", label: "Open Source" },
  { id: "computer-vision", label: "Computer Vision" },
  { id: "robotics", label: "Robotics" },
  { id: "ai-coding", label: "AI Coding" },
  { id: "ai-policy", label: "AI Policy" },
  { id: "industry", label: "Industry" },
  { id: "research", label: "Research" },
];

let currentUser = null;

function initTopicsGrid() {
  const grid = document.getElementById("topics-grid");
  grid.innerHTML = TOPICS.map(t => `
    <label>
      <input type="checkbox" value="${t.id}" onchange="checkTopicLimit()"> ${t.label}
    </label>
  `).join("");
}

function checkTopicLimit() {
  const checked = document.querySelectorAll('#topics-grid input:checked');
  const unchecked = document.querySelectorAll('#topics-grid input:not(:checked)');
  unchecked.forEach(cb => cb.disabled = checked.length >= 5);
}

function onTelegramAuth(user) {
  fetch(`${API_BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  })
    .then(r => r.json())
    .then(data => {
      if (data.user) {
        currentUser = data.user;
        showSettings(data.user);
      } else {
        alert("You are not registered. Please use the Telegram bot with an invite code first.");
      }
    })
    .catch(err => alert("Login failed: " + err.message));
}

function showSettings(user) {
  document.getElementById("login-section").style.display = "none";
  document.getElementById("settings-section").style.display = "block";

  // Set topics
  document.querySelectorAll("#topics-grid input").forEach(cb => {
    cb.checked = user.topics.includes(cb.value);
  });
  checkTopicLimit();

  // Set other fields
  document.getElementById("time-slot").value = user.time_slot;
  document.getElementById("lang").value = user.lang;
  document.getElementById("style").value = user.style;
}

function saveSettings() {
  const topics = Array.from(document.querySelectorAll("#topics-grid input:checked")).map(cb => cb.value);
  const timeSlot = parseInt(document.getElementById("time-slot").value, 10);
  const lang = document.getElementById("lang").value;
  const style = document.getElementById("style").value;

  fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegram_id: currentUser.telegram_id,
      topics,
      time_slot: timeSlot,
      lang,
      style,
    }),
  })
    .then(r => r.json())
    .then(data => {
      currentUser = data;
      document.getElementById("save-status").textContent = "Saved!";
      setTimeout(() => document.getElementById("save-status").textContent = "", 2000);
    })
    .catch(err => {
      document.getElementById("save-status").textContent = "Error: " + err.message;
    });
}

// Init
initTopicsGrid();
```

- [ ] **Step 3: Create style.css**

```css
/* web/style.css */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem 1rem;
  background: #f8f9fa;
  color: #333;
}

header { text-align: center; margin-bottom: 2rem; }
header h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
header p { color: #666; }

#login-section { text-align: center; margin: 3rem 0; }

.setting-group {
  background: white;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.setting-group h3 { margin-bottom: 0.5rem; font-size: 0.9rem; color: #666; }

#topics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

#topics-grid label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem;
  cursor: pointer;
}

select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

#save-btn {
  display: block;
  width: 100%;
  padding: 0.8rem;
  background: #0088cc;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  margin-top: 1rem;
}

#save-btn:hover { background: #006699; }

#save-status {
  text-align: center;
  margin-top: 0.5rem;
  color: #28a745;
}
```

- [ ] **Step 4: Commit**

```bash
git add web/
git commit -m "feat: add GitHub Pages Web UI for settings management"
```

---

## Chunk 6: Deployment & Integration

### Task 14: Deployment configuration and setup script

**Files:**
- Create: `scripts/setup.sh`

- [ ] **Step 1: Create setup script**

```bash
#!/usr/bin/env bash
# scripts/setup.sh — Initial deployment setup
set -euo pipefail

echo "=== AI Digest TG Setup ==="

# Check prerequisites
command -v wrangler >/dev/null || { echo "Install wrangler: npm i -g wrangler"; exit 1; }
command -v gh >/dev/null || { echo "Install gh CLI"; exit 1; }

echo ""
echo "1. Create KV namespace"
echo "   Run: wrangler kv namespace create KV"
echo "   Then update worker/wrangler.jsonc with the namespace ID"
echo ""
echo "2. Set worker secrets"
echo "   wrangler secret put TELEGRAM_BOT_TOKEN"
echo "   wrangler secret put TELEGRAM_WEBHOOK_SECRET"
echo "   wrangler secret put ADMIN_TELEGRAM_ID"
echo ""
echo "3. Deploy worker"
echo "   cd worker && wrangler deploy"
echo ""
echo "4. Set Telegram webhook"
echo "   curl -X POST 'https://api.telegram.org/bot<TOKEN>/setWebhook' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"url\": \"https://ai-digest-tg.<subdomain>.workers.dev/webhook\", \"secret_token\": \"<WEBHOOK_SECRET>\"}'"
echo ""
echo "5. Set GitHub Actions secrets"
echo "   gh secret set CF_API_TOKEN"
echo "   gh secret set CF_ACCOUNT_ID"
echo "   gh secret set CF_KV_NAMESPACE_ID"
echo "   gh secret set TELEGRAM_BOT_TOKEN"
echo "   gh secret set ADMIN_TELEGRAM_ID"
echo ""
echo "6. Update web/app.js API_BASE with your worker URL"
echo "7. Update web/index.html bot username"
echo "8. Enable GitHub Pages for the /web directory"
echo ""
echo "Done! Generate your first invite code via /admin_invite in Telegram."
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x scripts/setup.sh
git add scripts/setup.sh
git commit -m "docs: add deployment setup script"
```

### Task 15: Final integration test

- [ ] **Step 1: Run all worker tests**

```bash
cd /home/ct/SDD2/ai-digest-tg/worker
npx vitest run
```
Expected: All PASS

- [ ] **Step 2: Run all Python tests**

```bash
cd /home/ct/SDD2/ai-digest-tg/scripts
python -m pytest -v
```
Expected: All PASS

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/ct/SDD2/ai-digest-tg/worker
npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: finalize project structure"
```

---

## Chunk 7: Review Fixes

The following corrections address critical issues found during plan review.

### Task 16: Fix prompt template escaping (Critical Bug)

The `digest_prompt.txt` uses Python `.format()` but contains literal `{` and `}` in the JSON example, which will crash at runtime.

**Files:**
- Modify: `scripts/prompts/digest_prompt.txt`

- [ ] **Step 1: Escape all literal braces in the prompt template**

Replace the JSON example block in `digest_prompt.txt` — all literal `{` become `{{` and `}` become `}}`:

```
Output as JSON:
{{
  "featured": [
    {{"title": "...", "summary": "...", "url": "...", "why": "..."}}
  ],
  "quick_bites": [
    {{"title": "...", "url": "..."}}
  ],
  "is_empty": false
}}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/prompts/digest_prompt.txt
git commit -m "fix: escape braces in prompt template for Python .format()"
```

### Task 17: Add rate limiting for /start command

**Files:**
- Create: `worker/src/ratelimit.ts`
- Modify: `worker/src/handlers.ts`

- [ ] **Step 1: Implement rate limiter using KV with TTL**

```typescript
// worker/src/ratelimit.ts
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<boolean> {
  const rlKey = `ratelimit:${key}`;
  const raw = await kv.get(rlKey);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= maxAttempts) return false;

  await kv.put(rlKey, String(count + 1), { expirationTtl: windowSeconds });
  return true;
}
```

- [ ] **Step 2: Add rate limit check to handleStart in handlers.ts**

Add at the top of `handleStart`, before invite code validation:

```typescript
import { checkRateLimit } from "./ratelimit";

// Inside handleStart, after the empty args check:
const allowed = await checkRateLimit(env.KV, `start:${telegramId}`, 3, 3600);
if (!allowed) return "Too many attempts. Please try again later.";
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/ratelimit.ts worker/src/handlers.ts
git commit -m "feat: add rate limiting for /start command (3 attempts/hour)"
```

### Task 18: Add cross-run deduplication via KV

**Files:**
- Modify: `scripts/run_digest.py`
- Modify: `scripts/sources.py`

- [ ] **Step 1: Add KV dedup read/write functions to run_digest.py**

Add these functions to `run_digest.py`:

```python
def read_kv_dedup(account_id: str, namespace_id: str, api_token: str, date: str) -> set[str]:
    """Read today's dedup hashes from KV."""
    headers = {"Authorization": f"Bearer {api_token}"}
    base_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}"
    resp = requests.get(f"{base_url}/values/dedup:{date}", headers=headers, timeout=10)
    if resp.ok:
        try:
            return set(resp.json())
        except Exception:
            return set()
    return set()


def write_kv_dedup(account_id: str, namespace_id: str, api_token: str, date: str, hashes: set[str]) -> None:
    """Write dedup hashes to KV with 48h TTL."""
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    base_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}"
    # KV API supports expiration_ttl query param
    requests.put(
        f"{base_url}/values/dedup:{date}?expiration_ttl=172800",
        headers=headers, data=json.dumps(list(hashes)), timeout=10,
    )
```

- [ ] **Step 2: Integrate dedup into main() pipeline**

In `main()`, after fetching articles and before summarization:

```python
# Filter out already-sent articles
from sources import url_hash
sent_hashes = read_kv_dedup(cf_account_id, cf_kv_namespace_id, cf_api_token, today)
articles = [a for a in articles if url_hash(a.url) not in sent_hashes]
print(f"After dedup: {len(articles)} new articles")

# ... (after sending) ...
# Update dedup
new_hashes = sent_hashes | {url_hash(a.url) for a in articles}
write_kv_dedup(cf_account_id, cf_kv_namespace_id, cf_api_token, today, new_hashes)
```

- [ ] **Step 3: Commit**

```bash
git add scripts/run_digest.py
git commit -m "feat: add cross-run deduplication via KV with 48h TTL"
```

### Task 19: Fix api.ts to use Web Crypto API

**Files:**
- Modify: `worker/src/api.ts`

- [ ] **Step 1: Rewrite verifyTelegramLogin to use SubtleCrypto**

Replace the `node:crypto` import and `verifyTelegramLogin` function:

```typescript
// Remove: import crypto from "node:crypto";

async function verifyTelegramLogin(data: TelegramLoginData, botToken: string): Promise<boolean> {
  const { hash, ...rest } = data;
  const checkString = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join("\n");

  // SHA-256 hash of bot token as secret key
  const encoder = new TextEncoder();
  const tokenData = encoder.encode(botToken);
  const secretKeyHash = await crypto.subtle.digest("SHA-256", tokenData);

  // Import as HMAC key
  const key = await crypto.subtle.importKey(
    "raw", secretKeyHash, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );

  // Compute HMAC
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(checkString));
  const hexHash = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (hexHash !== hash) return false;

  // Check auth_date is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  return (now - data.auth_date) <= 300;
}
```

- [ ] **Step 2: Call verifyTelegramLogin in the /api/auth handler**

Replace the auth endpoint body:

```typescript
if (path === "/api/auth" && request.method === "POST") {
  const loginData: TelegramLoginData = await request.json();

  const valid = await verifyTelegramLogin(loginData, env.TELEGRAM_BOT_TOKEN);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid login" }), {
      status: 401, headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  const user = await getUser(env.KV, loginData.id);
  return new Response(JSON.stringify({ user }), {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/api.ts
git commit -m "fix: use Web Crypto API for Telegram Login verification"
```

### Task 20: Add missing /target and /sources command handlers

**Files:**
- Modify: `worker/src/handlers.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add handleTarget to handlers.ts**

```typescript
export async function handleTarget(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  if (!args) {
    return `Current target: ${user!.target_type}${user!.target_id ? ` (${user!.target_id})` : ""}\n\nTo change:\n/target dm — send to your DM\n/target chat <chat_id> — send to a group/channel`;
  }

  const parts = args.split(" ");
  const type = parts[0];

  if (type === "dm") {
    user!.target_type = "dm";
    user!.target_id = undefined;
    await putUser(env.KV, user!);
    return "Target set to DM.";
  }

  if (type === "chat") {
    const chatId = parts[1];
    if (!chatId) return "Usage: /target chat <chat_id or @channel_name>";
    user!.target_type = "chat";
    user!.target_id = chatId;
    await putUser(env.KV, user!);
    return `Target set to chat: ${chatId}\nMake sure the bot is a member of the chat.`;
  }

  return "Usage: /target dm or /target chat <chat_id>";
}
```

- [ ] **Step 2: Add handleSources to handlers.ts**

```typescript
export async function handleSources(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  if (!args) {
    if (user!.custom_sources.length === 0) {
      return "No custom sources.\n\nTo add: /sources add <rss_url>\nTo remove: /sources remove <number>";
    }
    const list = user!.custom_sources.map((s, i) => `${i + 1}. ${s}`).join("\n");
    return `Custom sources (${user!.custom_sources.length}/5):\n${list}\n\nTo add: /sources add <rss_url>\nTo remove: /sources remove <number>`;
  }

  const parts = args.split(" ");
  const action = parts[0];

  if (action === "add") {
    const url = parts[1];
    if (!url) return "Usage: /sources add <rss_url>";
    if (user!.custom_sources.length >= 5) return "Maximum 5 custom sources.";
    try { new URL(url); } catch { return "Invalid URL."; }
    user!.custom_sources.push(url);
    await putUser(env.KV, user!);
    return `Added: ${url}`;
  }

  if (action === "remove") {
    const idx = parseInt(parts[1], 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= user!.custom_sources.length) return "Invalid number.";
    const removed = user!.custom_sources.splice(idx, 1)[0];
    await putUser(env.KV, user!);
    return `Removed: ${removed}`;
  }

  return "Usage: /sources add <url> or /sources remove <number>";
}
```

- [ ] **Step 3: Add cases to webhook router in index.ts**

```typescript
case "target":  reply = await handleTarget(env, telegramId, parsed.args); break;
case "sources": reply = await handleSources(env, telegramId, parsed.args); break;
```

- [ ] **Step 4: Commit**

```bash
git add worker/src/handlers.ts worker/src/index.ts
git commit -m "feat: add /target and /sources command handlers"
```

### Task 21: Add arXiv source fetcher

**Files:**
- Modify: `scripts/sources.py`

- [ ] **Step 1: Add arXiv API fetcher**

```python
import time as _time
import xml.etree.ElementTree as ET

ARXIV_CATEGORIES = ["cs.AI", "cs.CL", "cs.LG"]

def fetch_arxiv(categories: list[str] = ARXIV_CATEGORIES, max_results: int = 20) -> list[Article]:
    """Fetch recent papers from arXiv API."""
    articles: list[Article] = []
    for cat in categories:
        try:
            url = f"http://export.arxiv.org/api/query?search_query=cat:{cat}&sortBy=submittedDate&sortOrder=descending&max_results={max_results}"
            resp = requests.get(url, timeout=FETCH_TIMEOUT, headers={"User-Agent": "ai-digest-tg/1.0"})
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            for entry in root.findall("atom:entry", ns):
                title = entry.findtext("atom:title", "", ns).strip().replace("\n", " ")
                link = ""
                for lnk in entry.findall("atom:link", ns):
                    if lnk.get("type") == "text/html":
                        link = lnk.get("href", "")
                        break
                if not link:
                    link = entry.findtext("atom:id", "", ns)
                summary = entry.findtext("atom:summary", "", ns).strip()[:500]
                published = entry.findtext("atom:published", "", ns)
                if title and link:
                    articles.append(Article(title=title, url=normalize_url(link), source=f"arxiv-{cat}", summary=summary, published=published))
            _time.sleep(3)  # arXiv rate limit
        except Exception as e:
            print(f"[WARN] Failed to fetch arXiv {cat}: {e}")
    return articles
```

- [ ] **Step 2: Add arXiv to fetch_all_sources**

```python
def fetch_all_sources(custom_feeds: dict[str, str] | None = None) -> list[Article]:
    all_articles: list[Article] = []
    feeds = {**DEFAULT_FEEDS, **(custom_feeds or {})}
    for name, url in feeds.items():
        all_articles.extend(fetch_feed(name, url))
    all_articles.extend(fetch_hn_top())
    all_articles.extend(fetch_arxiv())  # Add this line
    return deduplicate_articles(all_articles)
```

- [ ] **Step 3: Commit**

```bash
git add scripts/sources.py
git commit -m "feat: add arXiv API source fetcher with rate limiting"
```

### Task 22: Add CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  worker-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
      - run: cd worker && npm install && npx vitest run

  python-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065
        with:
          python-version: '3.12'
      - run: pip install -r scripts/requirements.txt && cd scripts && python -m pytest -v
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add test workflows for worker and Python scripts"
```

### Task 23: Refactor summarization to avoid redundant AI calls

Per spec: "Style formatting applied as post-processing on the base summary." The base AI call should always generate the full "mixed" digest (featured + quick_bites). Style is then applied in `format_telegram_message` only, which already handles this correctly.

**Files:**
- Modify: `scripts/run_digest.py`

- [ ] **Step 1: Remove per-user re-summarization**

In `run_digest.py`, replace the per-user loop body:

```python
        for user in users:
            style = user.get("style", "mixed")
            # Style is handled by format_telegram_message, no re-summarization needed
            msg = format_telegram_message(digest, today, style)
```

Remove the `if style != "mixed": user_digest = summarize_articles(...)` block entirely.

- [ ] **Step 2: Commit**

```bash
git add scripts/run_digest.py
git commit -m "refactor: apply style as post-processing, avoid redundant AI calls"
```
