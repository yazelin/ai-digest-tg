import type { Env, UserSettings } from "./types";
import { getUser, putUser } from "./kv";

interface TelegramLoginData {
  id: number;
  auth_date: number;
  hash: string;
  [key: string]: string | number;
}

async function verifyTelegramLogin(data: TelegramLoginData, botToken: string): Promise<boolean> {
  const { hash, ...rest } = data;
  const checkString = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join("\n");

  const encoder = new TextEncoder();
  const tokenData = encoder.encode(botToken);
  const secretKeyHash = await crypto.subtle.digest("SHA-256", tokenData);

  const key = await crypto.subtle.importKey(
    "raw", secretKeyHash, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(checkString));
  const hexHash = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (hexHash !== hash) return false;

  const now = Math.floor(Date.now() / 1000);
  return (now - data.auth_date) <= 300;
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

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // POST /api/auth — verify Telegram Login Widget
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
