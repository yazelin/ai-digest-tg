import type { Env, UserSettings, Topic, TimeSlot } from "./types";
import { VALID_TOPICS, VALID_TIME_SLOTS } from "./types";
import { getUser, putUser, getInvite, markInviteUsed, generateInviteCode, putInvite, listUsersBySlot } from "./kv";
import { checkRateLimit } from "./ratelimit";

// ── helpers ──────────────────────────────────────────────────────────────────

function requireUser(user: UserSettings | null): string | null {
  if (!user) return "You are not registered. Use /start <invite_code> to get started.";
  return null;
}

/** Round any hour 0-23 to the nearest valid TimeSlot (0,3,6,9,12,15,18,21). */
export function roundToSlot(hour: number): TimeSlot {
  let best = VALID_TIME_SLOTS[0];
  let bestDist = Math.abs(hour - best);
  for (const slot of VALID_TIME_SLOTS) {
    const dist = Math.abs(hour - slot);
    if (dist < bestDist) {
      best = slot;
      bestDist = dist;
    }
  }
  return best;
}

// ── /start ───────────────────────────────────────────────────────────────────

export async function handleStart(env: Env, telegramId: number, args: string): Promise<string> {
  const code = args.trim();
  if (!code) {
    return "Please provide an invite code: /start <invite_code>";
  }

  const allowed = await checkRateLimit(env.KV, `start:${telegramId}`, 3, 3600);
  if (!allowed) return "Too many attempts. Please try again later.";

  const invite = await getInvite(env.KV, code);
  if (!invite) {
    return "Invalid invite code. Please check the code and try again.";
  }
  if (invite.used_by !== null) {
    return "This invite code has already been used.";
  }

  // Check if user already exists
  const existing = await getUser(env.KV, telegramId);
  if (existing) {
    return "You are already registered! Use /status to see your settings.";
  }

  const now = new Date().toISOString();
  const user: UserSettings = {
    telegram_id: telegramId,
    target_type: "dm",
    topics: ["llm", "ai-agents"],
    time_slot: 9,
    lang: "en",
    style: "mixed",
    custom_sources: [],
    invite_code: code,
    created_at: now,
    active: true,
    consecutive_failures: 0,
  };

  await putUser(env.KV, user);
  await markInviteUsed(env.KV, code, telegramId);

  return (
    "Welcome to AI Digest! 🎉\n\n" +
    "Your account is set up with defaults:\n" +
    "• Topics: llm, ai-agents\n" +
    "• Delivery time: 9:00 UTC\n" +
    "• Language: en\n" +
    "• Style: mixed\n\n" +
    "Use /help to see all available commands."
  );
}

// ── /topics ───────────────────────────────────────────────────────────────────

export async function handleTopics(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  if (!args.trim()) {
    return `Your current topics: ${user!.topics.join(", ")}\n\nAvailable: ${VALID_TOPICS.join(", ")}\n\nUse /topics <topic1,topic2,...> to update.`;
  }

  const requested = args.split(",").map(t => t.trim()).filter(Boolean);
  const invalid = requested.filter(t => !VALID_TOPICS.includes(t as Topic));
  if (invalid.length > 0) {
    return `Invalid topics: ${invalid.join(", ")}\n\nAvailable: ${VALID_TOPICS.join(", ")}`;
  }
  if (requested.length === 0) {
    return "Please provide at least one topic.";
  }

  user!.topics = requested as Topic[];
  await putUser(env.KV, user!);
  return `Updated topics: ${user!.topics.join(", ")}`;
}

// ── /time ─────────────────────────────────────────────────────────────────────

export async function handleTime(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  if (!args.trim()) {
    return `Your current delivery time: ${user!.time_slot}:00 UTC\n\nUse /time <hour> (0-23) to update.`;
  }

  const hour = parseInt(args.trim(), 10);
  if (isNaN(hour) || hour < 0 || hour > 23) {
    return "Please provide a valid hour between 0 and 23.";
  }

  const slot = roundToSlot(hour);
  user!.time_slot = slot;
  await putUser(env.KV, user!);
  return `Updated delivery time to ${slot}:00 UTC.`;
}

// ── /lang ─────────────────────────────────────────────────────────────────────

export async function handleLang(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  const lang = args.trim() as "en" | "zh-TW";
  if (!lang) {
    return `Your current language: ${user!.lang}\n\nAvailable: en, zh-TW\n\nUse /lang <en|zh-TW> to update.`;
  }
  if (lang !== "en" && lang !== "zh-TW") {
    return "Invalid language. Available: en, zh-TW";
  }

  user!.lang = lang;
  await putUser(env.KV, user!);
  return `Updated language to: ${lang}`;
}

// ── /style ────────────────────────────────────────────────────────────────────

export async function handleStyle(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  const style = args.trim() as "mixed" | "brief" | "deep";
  if (!style) {
    return `Your current style: ${user!.style}\n\nAvailable: mixed, brief, deep\n\nUse /style <mixed|brief|deep> to update.`;
  }
  if (style !== "mixed" && style !== "brief" && style !== "deep") {
    return "Invalid style. Available: mixed, brief, deep";
  }

  user!.style = style;
  await putUser(env.KV, user!);
  return `Updated style to: ${style}`;
}

// ── /status ───────────────────────────────────────────────────────────────────

export async function handleStatus(env: Env, telegramId: number): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  const u = user!;
  const status = u.active ? "active" : "paused";
  return (
    `<b>Your Settings</b>\n\n` +
    `Status: ${status}\n` +
    `Topics: ${u.topics.join(", ")}\n` +
    `Delivery time: ${u.time_slot}:00 UTC\n` +
    `Language: ${u.lang}\n` +
    `Style: ${u.style}\n` +
    `Custom sources: ${u.custom_sources.length > 0 ? u.custom_sources.join(", ") : "none"}\n` +
    `Target: ${u.target_type}${u.target_id ? ` (${u.target_id})` : ""}`
  );
}

// ── /stop ─────────────────────────────────────────────────────────────────────

export async function handleStop(env: Env, telegramId: number): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  user!.active = false;
  await putUser(env.KV, user!);
  return "Digest delivery paused. Use /resume to start again.";
}

// ── /resume ───────────────────────────────────────────────────────────────────

export async function handleResume(env: Env, telegramId: number): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  user!.active = true;
  await putUser(env.KV, user!);
  return "Digest delivery resumed!";
}

// ── /help ─────────────────────────────────────────────────────────────────────

export async function handleHelp(): Promise<string> {
  return (
    "<b>AI Digest Commands</b>\n\n" +
    "/start <code> - Register with invite code\n" +
    "/topics [list] - View or set topics\n" +
    "/time <hour> - Set delivery time (UTC)\n" +
    "/lang <en|zh-TW> - Set language\n" +
    "/style <mixed|brief|deep> - Set digest style\n" +
    "/target dm|chat [chat_id] - Set delivery target\n" +
    "/sources add <url>|remove <n> - Manage custom RSS\n" +
    "/status - Show your current settings\n" +
    "/stop - Pause digest delivery\n" +
    "/resume - Resume digest delivery\n" +
    "/help - Show this help message"
  );
}

// ── /target ───────────────────────────────────────────────────────────────────

export async function handleTarget(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  const parts = args.trim().split(/\s+/);
  const targetType = parts[0] as "dm" | "chat";

  if (!targetType) {
    return `Current target: ${user!.target_type}${user!.target_id ? ` (${user!.target_id})` : ""}\n\nUse /target dm or /target chat <chat_id>`;
  }

  if (targetType === "dm") {
    user!.target_type = "dm";
    user!.target_id = undefined;
    await putUser(env.KV, user!);
    return "Target set to DM (direct message).";
  }

  if (targetType === "chat") {
    const chatId = parts[1];
    if (!chatId) {
      return "Please provide a chat ID: /target chat <chat_id>";
    }
    user!.target_type = "chat";
    user!.target_id = chatId;
    await putUser(env.KV, user!);
    return `Target set to chat: ${chatId}`;
  }

  return "Invalid target type. Use: dm or chat";
}

// ── /sources ──────────────────────────────────────────────────────────────────

const MAX_CUSTOM_SOURCES = 5;

export async function handleSources(env: Env, telegramId: number, args: string): Promise<string> {
  const user = await getUser(env.KV, telegramId);
  const err = requireUser(user);
  if (err) return err;

  if (!args.trim()) {
    if (user!.custom_sources.length === 0) {
      return "No custom sources added yet.\n\nUse /sources add <url> to add one.";
    }
    const list = user!.custom_sources.map((s, i) => `${i + 1}. ${s}`).join("\n");
    return `Your custom sources:\n${list}\n\nUse /sources add <url> or /sources remove <number>`;
  }

  const spaceIdx = args.indexOf(" ");
  const subCommand = spaceIdx === -1 ? args.trim() : args.slice(0, spaceIdx).trim();
  const subArgs = spaceIdx === -1 ? "" : args.slice(spaceIdx + 1).trim();

  if (subCommand === "add") {
    const url = subArgs;
    if (!url) return "Please provide a URL: /sources add <url>";
    if (user!.custom_sources.length >= MAX_CUSTOM_SOURCES) {
      return `You can have at most ${MAX_CUSTOM_SOURCES} custom sources. Remove one first.`;
    }
    if (user!.custom_sources.includes(url)) {
      return "This source is already in your list.";
    }
    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return "Invalid URL. Please provide a valid RSS feed URL.";
    }
    user!.custom_sources.push(url);
    await putUser(env.KV, user!);
    return `Added source: ${url}`;
  }

  if (subCommand === "remove") {
    const index = parseInt(subArgs, 10);
    if (isNaN(index) || index < 1 || index > user!.custom_sources.length) {
      return `Invalid number. Use a number between 1 and ${user!.custom_sources.length}.`;
    }
    const removed = user!.custom_sources.splice(index - 1, 1)[0];
    await putUser(env.KV, user!);
    return `Removed source: ${removed}`;
  }

  return "Unknown subcommand. Use: /sources add <url> or /sources remove <number>";
}

// ── admin commands ────────────────────────────────────────────────────────────

function isAdmin(env: Env, telegramId: number): boolean {
  return String(telegramId) === env.ADMIN_TELEGRAM_ID;
}

export async function handleAdminInvite(env: Env, telegramId: number): Promise<string> {
  if (!isAdmin(env, telegramId)) {
    return "Unauthorized. This command is for admins only.";
  }

  const code = generateInviteCode();
  const invite = {
    created_by: String(telegramId),
    used_by: null,
    created_at: new Date().toISOString(),
  };
  await putInvite(env.KV, code, invite);
  return `New invite code created:\n<code>${code}</code>`;
}

export async function handleAdminList(env: Env, telegramId: number): Promise<string> {
  if (!isAdmin(env, telegramId)) {
    return "Unauthorized. This command is for admins only.";
  }

  const { keys } = await env.KV.list({ prefix: "user:" });
  if (keys.length === 0) {
    return "No registered users.";
  }

  const lines: string[] = [`<b>Registered Users (${keys.length})</b>\n`];
  for (const key of keys) {
    const raw = await env.KV.get(key.name);
    if (!raw) continue;
    const user: UserSettings = JSON.parse(raw);
    lines.push(
      `• ID: ${user.telegram_id} | ${user.active ? "active" : "paused"} | slot: ${user.time_slot}:00 | topics: ${user.topics.join(",")}`,
    );
  }
  return lines.join("\n");
}

export async function handleAdminRevoke(env: Env, telegramId: number, args: string): Promise<string> {
  if (!isAdmin(env, telegramId)) {
    return "Unauthorized. This command is for admins only.";
  }

  const code = args.trim();
  if (!code) {
    return "Please provide a code to revoke: /admin_revoke <code>";
  }

  const invite = await getInvite(env.KV, code);
  if (!invite) {
    return `Invite code not found: ${code}`;
  }

  await env.KV.delete(`invite:${code}`);
  return `Revoked invite code: ${code}`;
}
