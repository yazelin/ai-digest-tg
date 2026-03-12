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
