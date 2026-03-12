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
      link_preview_options: { is_disabled: true },
    }),
  });
  if (resp.status === 429) return false;
  const result = await resp.json() as { ok: boolean };
  return result.ok;
}
