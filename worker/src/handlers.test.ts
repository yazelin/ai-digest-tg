import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleStart, handleTopics, handleTime, handleStatus, handleStop, handleResume, handleStyle, handleLang } from "./handlers";
import type { Env, UserSettings, InviteCode } from "./types";

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
    const result = await handleStart(mockEnv(kv), 123, "");
    expect(result).toContain("invite code");
  });

  it("rejects invalid invite code", async () => {
    const kv = mockKV();
    const result = await handleStart(mockEnv(kv), 123, "badcode");
    expect(result).toContain("Invalid");
  });

  it("accepts valid unused invite code and creates user", async () => {
    const kv = mockKV();
    const invite: InviteCode = { created_by: "admin", used_by: null, created_at: "2026-03-12T00:00:00Z" };
    kv._store.set("invite:goodcode", JSON.stringify(invite));
    const result = await handleStart(mockEnv(kv), 123, "goodcode");
    expect(result).toContain("Welcome");
    const user = JSON.parse(kv._store.get("user:123")!);
    expect(user.telegram_id).toBe(123);
    expect(user.active).toBe(true);
  });

  it("rejects already-used invite code", async () => {
    const kv = mockKV();
    const invite: InviteCode = { created_by: "admin", used_by: 456, created_at: "2026-03-12T00:00:00Z" };
    kv._store.set("invite:usedcode", JSON.stringify(invite));
    const result = await handleStart(mockEnv(kv), 123, "usedcode");
    expect(result).toContain("already been used");
  });
});

describe("handleTopics", () => {
  it("shows current topics when no args", async () => {
    const kv = mockKV();
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm", "ai-safety"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));
    const result = await handleTopics(mockEnv(kv), 123, "");
    expect(result).toContain("llm");
    expect(result).toContain("ai-safety");
  });

  it("updates topics with valid args", async () => {
    const kv = mockKV();
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));
    const result = await handleTopics(mockEnv(kv), 123, "ai-agents,research");
    expect(result).toContain("Updated");
    const updated = JSON.parse(kv._store.get("user:123")!);
    expect(updated.topics).toEqual(["ai-agents", "research"]);
  });
});

describe("handleTime", () => {
  it("updates time slot with valid hour", async () => {
    const kv = mockKV();
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));
    const result = await handleTime(mockEnv(kv), 123, "15");
    expect(result).toContain("15:00");
  });

  it("rounds to nearest slot", async () => {
    const kv = mockKV();
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));
    const result = await handleTime(mockEnv(kv), 123, "10");
    expect(result).toContain("9:00");
  });
});

describe("handleStatus", () => {
  it("shows user settings", async () => {
    const kv = mockKV();
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm", "ai-agents"],
      time_slot: 9, lang: "zh-TW", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));
    const result = await handleStatus(mockEnv(kv), 123);
    expect(result).toContain("llm");
    expect(result).toContain("9:00");
    expect(result).toContain("zh-TW");
  });
});

describe("handleStop / handleResume", () => {
  it("stop deactivates user", async () => {
    const kv = mockKV();
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: true, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));
    await handleStop(mockEnv(kv), 123);
    const updated = JSON.parse(kv._store.get("user:123")!);
    expect(updated.active).toBe(false);
  });

  it("resume reactivates user", async () => {
    const kv = mockKV();
    const user: UserSettings = {
      telegram_id: 123, target_type: "dm", topics: ["llm"],
      time_slot: 9, lang: "en", style: "mixed", custom_sources: [],
      invite_code: "x", created_at: "2026-03-12T00:00:00Z", active: false, consecutive_failures: 0,
    };
    kv._store.set("user:123", JSON.stringify(user));
    await handleResume(mockEnv(kv), 123);
    const updated = JSON.parse(kv._store.get("user:123")!);
    expect(updated.active).toBe(true);
  });
});
