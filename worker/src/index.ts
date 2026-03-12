import { Env } from "./types";
import { verifyWebhookSecret, parseCommand, sendMessage } from "./telegram";
import {
  handleStart, handleTopics, handleTime, handleLang,
  handleStyle, handleStatus, handleStop, handleResume,
  handleHelp, handleAdminInvite, handleAdminList, handleAdminRevoke,
  handleTarget, handleSources,
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
  if (!message?.text || !message.from) return new Response("OK");

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
    case "target":       reply = await handleTarget(env, telegramId, parsed.args); break;
    case "sources":      reply = await handleSources(env, telegramId, parsed.args); break;
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
    if (url.pathname.startsWith("/api/")) {
      return new Response("Not implemented", { status: 501 });
    }
    return new Response("AI Digest TG", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
