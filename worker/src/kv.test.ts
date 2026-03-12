import { describe, it, expect, vi, beforeEach } from "vitest";
import { getUser, putUser, listUsersBySlot, getInvite, putInvite, markInviteUsed } from "./kv";
import type { UserSettings, InviteCode } from "./types";

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
