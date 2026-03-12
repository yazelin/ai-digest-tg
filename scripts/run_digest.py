"""Main pipeline script for AI Digest GitHub Actions."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from typing import Optional

import json

import requests

from sources import fetch_all_sources, url_hash, Article
from summarize import summarize_articles, DigestResult, format_telegram_message
from send_telegram import send_message, split_message

# Valid time slots (UTC hours) matching worker/src/types.ts
_VALID_TIME_SLOTS = [0, 3, 6, 9, 12, 15, 18, 21]

_MAX_CONSECUTIVE_FAILURES = 5
_CF_KV_BASE = "https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}"


def get_current_slot() -> int:
    """Return the current time slot as UTC hour (0,3,6,...,21).

    Cron runs at these UTC hours. We round the current UTC hour to the
    nearest valid slot so that minor scheduling delays still match.
    """
    utc_hour = datetime.now(timezone.utc).hour
    best = _VALID_TIME_SLOTS[0]
    best_dist = abs(utc_hour - best)
    for slot in _VALID_TIME_SLOTS:
        dist = abs(utc_hour - slot)
        if dist < best_dist:
            best = slot
            best_dist = dist
    return best


def _cf_headers() -> dict[str, str]:
    token = os.environ["CF_API_TOKEN"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _kv_base_url() -> str:
    account_id = os.environ["CF_ACCOUNT_ID"]
    namespace_id = os.environ["CF_KV_NAMESPACE_ID"]
    return _CF_KV_BASE.format(account_id=account_id, namespace_id=namespace_id)


def read_kv_dedup(date: str) -> set[str]:
    """Read dedup hashes for a given date from Cloudflare KV."""
    base = _kv_base_url()
    headers = _cf_headers()
    try:
        resp = requests.get(f"{base}/values/dedup:{date}", headers=headers, timeout=10)
        if resp.ok:
            try:
                return set(resp.json())
            except Exception:
                return set()
    except Exception as exc:
        print(f"[kv] Failed to read dedup for {date}: {exc}")
    return set()


def write_kv_dedup(date: str, hashes: set[str]) -> None:
    """Write dedup hashes for a given date to Cloudflare KV (TTL 48 h)."""
    base = _kv_base_url()
    headers = {**_cf_headers()}
    try:
        requests.put(
            f"{base}/values/dedup:{date}?expiration_ttl=172800",
            headers=headers,
            data=json.dumps(list(hashes)),
            timeout=10,
        )
    except Exception as exc:
        print(f"[kv] Failed to write dedup for {date}: {exc}")


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
    tid = user.get("telegram_id", "")
    if not tid:
        return False
    key = f"user:{tid}"
    base = _kv_base_url()
    headers = _cf_headers()
    try:
        resp = requests.put(
            f"{base}/values/{key}",
            headers=headers,
            data=json.dumps(user),
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as exc:
        print(f"[kv] Failed to update user {tid}: {exc}")
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
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"[pipeline] Starting digest for slot={slot} (UTC), date={today}")

    # Read users from KV
    try:
        all_users = read_kv_users()
    except Exception as exc:
        notify_admin(f"Failed to read KV users: {exc}")
        sys.exit(1)

    # Filter: active users whose time_slot matches current slot
    target_users = [
        u for u in all_users
        if u.get("active", True) and u.get("time_slot") == slot
    ]

    if not target_users:
        print(f"[pipeline] No active users for slot={slot}, exiting.")
        return

    print(f"[pipeline] {len(target_users)} user(s) to deliver to.")

    # Collect unique (topics, lang) combos to minimise AI calls
    # topics is a list in KV, convert to comma-separated string for AI prompt
    combos: dict[tuple[str, str], DigestResult] = {}
    combo_keys: set[tuple[str, str]] = set()
    for user in target_users:
        topics_list = user.get("topics", ["llm", "ai-agents"])
        topics = ",".join(topics_list) if isinstance(topics_list, list) else str(topics_list)
        lang = user.get("lang", "en")
        combo_keys.add((topics, lang))

    # Fetch sources once
    print("[pipeline] Fetching sources...")
    try:
        articles = fetch_all_sources(custom_feeds=None)
    except Exception as exc:
        notify_admin(f"Source fetch failed: {exc}")
        articles = []

    print(f"[pipeline] Fetched {len(articles)} unique articles.")

    # Cross-run deduplication: skip articles already sent today
    sent_hashes = read_kv_dedup(today)
    articles = [a for a in articles if url_hash(a.url) not in sent_hashes]
    print(f"[pipeline] {len(articles)} articles after dedup filter.")

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
        tid = str(user.get("telegram_id", ""))
        # Determine delivery target: DM or specific chat
        target_type = user.get("target_type", "dm")
        if target_type == "chat" and user.get("target_id"):
            deliver_to = str(user["target_id"])
        else:
            deliver_to = tid

        topics_list = user.get("topics", ["llm", "ai-agents"])
        topics = ",".join(topics_list) if isinstance(topics_list, list) else str(topics_list)
        lang = user.get("lang", "en")
        style = user.get("style", "mixed")

        digest = combos.get((topics, lang))
        if digest is None:
            print(f"[pipeline] No digest for user {tid}, skipping.")
            continue

        message = format_telegram_message(digest, today, style)
        if not message:
            print(f"[pipeline] Empty digest for user {tid}, skipping.")
            continue

        parts = split_message(message)
        success = True
        for part in parts:
            if not send_message(bot_token, deliver_to, part):
                success = False
                break

        if success:
            user["consecutive_failures"] = 0
            print(f"[pipeline] Delivered to {deliver_to}")
        else:
            failures = user.get("consecutive_failures", 0) + 1
            user["consecutive_failures"] = failures
            print(f"[pipeline] Delivery failed for {deliver_to} (failures={failures})")
            if failures >= _MAX_CONSECUTIVE_FAILURES:
                user["active"] = False
                notify_admin(
                    f"Deactivated user {tid} after {failures} consecutive failures."
                )

        update_kv_user(user)

    # Persist dedup hashes for articles that were processed this run
    new_hashes = sent_hashes | {url_hash(a.url) for a in articles}
    write_kv_dedup(today, new_hashes)

    print("[pipeline] Done.")


if __name__ == "__main__":
    main()
