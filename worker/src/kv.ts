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
