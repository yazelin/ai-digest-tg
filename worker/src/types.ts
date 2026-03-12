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
