"""Main pipeline script for AI Digest GitHub Actions."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone, timedelta
from typing import Optional

import requests

from sources import fetch_all_sources, Article
from summarize import summarize_articles, DigestResult, format_telegram_message
from send_telegram import send_message, split_message

# UTC+8 timezone
_TZ_UTC8 = timezone(timedelta(hours=8))

# Slot definitions: name -> (start_hour_utc8, end_hour_utc8)
# Delivery slots roughly align with morning/midday/evening in UTC+8
_SLOTS: dict[str, tuple[int, int]] = {
    "morning": (7, 10),
    "midday": (11, 14),
    "afternoon": (15, 18),
    "evening": (19, 22),
    "night": (23, 2),  # wraps midnight
}

_MAX_CONSECUTIVE_FAILURES = 5
_CF_KV_BASE = "https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}"


def get_current_slot() -> str:
    """Determine the current delivery slot from UTC+8 time."""
    now_utc8 = datetime.now(_TZ_UTC8)
    hour = now_utc8.hour
    for slot_name, (start, end) in _SLOTS.items():
        if start <= end:
            if start <= hour < end:
                return slot_name
        else:
            # Wraps midnight
            if hour >= start or hour < end:
                return slot_name
    return "morning"


def _cf_headers() -> dict[str, str]:
    token = os.environ["CF_API_TOKEN"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _kv_base_url() -> str:
    account_id = os.environ["CF_ACCOUNT_ID"]
    namespace_id = os.environ["CF_KV_NAMESPACE_ID"]
    return _CF_KV_BASE.format(account_id=account_id, namespace_id=namespace_id)


def read_kv_users() -> list[dict]:
    """Read all users from Cloudflare KV via API."""
    base = _kv_base_url()
    headers = _cf_headers()
    users: list[dict] = []

    try:
        # List all keys
        resp = requests.get(f"{base}/keys", headers=headers, timeout=15)
        resp.raise_for_status()
        keys_data = resp.json()
        keys = [k["name"] for k in keys_data.get("result", [])]
    except Exception as exc:
        print(f"[kv] Failed to list KV keys: {exc}")
        return []

    for key in keys:
        if not key.startswith("user:"):
            continue
        try:
            val_resp = requests.get(f"{base}/values/{key}", headers=headers, timeout=10)
            val_resp.raise_for_status()
            user = val_resp.json()
            if isinstance(user, dict):
                users.append(user)
        except Exception as exc:
            print(f"[kv] Failed to read key {key}: {exc}")

    return users


def update_kv_user(user: dict) -> bool:
    """Update a user record in Cloudflare KV."""
    chat_id = user.get("chatId") or user.get("chat_id", "")
    if not chat_id:
        return False
    key = f"user:{chat_id}"
    base = _kv_base_url()
    headers = _cf_headers()
    try:
        resp = requests.put(
            f"{base}/values/{key}",
            headers=headers,
            json=user,
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as exc:
        print(f"[kv] Failed to update user {chat_id}: {exc}")
        return False


def notify_admin(message: str) -> None:
    """Send a Telegram message to the admin."""
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    admin_id = os.environ.get("ADMIN_TELEGRAM_ID", "")
    if not bot_token or not admin_id:
        print(f"[admin] Cannot notify admin (missing env): {message}")
        return
    send_message(bot_token, admin_id, f"[AI Digest Admin]\n{message}")


def main() -> None:
    slot = get_current_slot()
    now_utc8 = datetime.now(_TZ_UTC8)
    today = now_utc8.strftime("%Y-%m-%d")
    print(f"[pipeline] Starting digest for slot={slot}, date={today}")

    # Read users from KV
    try:
        all_users = read_kv_users()
    except Exception as exc:
        notify_admin(f"Failed to read KV users: {exc}")
        sys.exit(1)

    # Filter: active users whose slot matches
    target_users = [
        u for u in all_users
        if u.get("active", True) and u.get("slot", "morning") == slot
    ]

    if not target_users:
        print(f"[pipeline] No active users for slot={slot}, exiting.")
        return

    print(f"[pipeline] {len(target_users)} user(s) to deliver to.")

    # Collect unique (topics, lang) combos to minimise AI calls
    combos: dict[tuple[str, str], DigestResult] = {}
    combo_keys: set[tuple[str, str]] = set()
    for user in target_users:
        topics = user.get("topics", "AI, machine learning")
        lang = user.get("lang", "English")
        combo_keys.add((topics, lang))

    # Fetch sources once
    print("[pipeline] Fetching sources...")
    try:
        articles = fetch_all_sources(custom_feeds=None)
    except Exception as exc:
        notify_admin(f"Source fetch failed: {exc}")
        articles = []

    print(f"[pipeline] Fetched {len(articles)} unique articles.")

    # Summarize per unique (topics, lang)
    bot_token = os.environ["TELEGRAM_BOT_TOKEN"]
    for topics, lang in combo_keys:
        print(f"[pipeline] Summarizing for topics={topics!r}, lang={lang!r}")
        try:
            # Use style="mixed" for the AI call; per-user style is post-processing
            digest = summarize_articles(articles, topics=topics, lang=lang, style="mixed")
            combos[(topics, lang)] = digest
        except Exception as exc:
            print(f"[pipeline] Summarize failed for ({topics}, {lang}): {exc}")
            notify_admin(f"Summarize failed for topics={topics!r}, lang={lang!r}: {exc}")

    # Deliver per user
    for user in target_users:
        chat_id = str(user.get("chatId") or user.get("chat_id", ""))
        topics = user.get("topics", "AI, machine learning")
        lang = user.get("lang", "English")
        style = user.get("style", "mixed")

        digest = combos.get((topics, lang))
        if digest is None:
            print(f"[pipeline] No digest for user {chat_id}, skipping.")
            continue

        message = format_telegram_message(digest, today, style)
        if not message:
            print(f"[pipeline] Empty digest for user {chat_id}, skipping.")
            continue

        parts = split_message(message)
        success = True
        for part in parts:
            if not send_message(bot_token, chat_id, part):
                success = False
                break

        if success:
            user["consecutiveFailures"] = 0
            print(f"[pipeline] Delivered to {chat_id}")
        else:
            failures = user.get("consecutiveFailures", 0) + 1
            user["consecutiveFailures"] = failures
            print(f"[pipeline] Delivery failed for {chat_id} (failures={failures})")
            if failures >= _MAX_CONSECUTIVE_FAILURES:
                user["active"] = False
                notify_admin(
                    f"Deactivated user {chat_id} after {failures} consecutive failures."
                )

        update_kv_user(user)

    print("[pipeline] Done.")


if __name__ == "__main__":
    main()
