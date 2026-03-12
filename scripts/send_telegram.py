"""Telegram delivery for AI Digest pipeline."""

from __future__ import annotations

import time

import requests

_TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"
_MAX_ATTEMPTS = 3


def send_message(bot_token: str, chat_id: str, text: str) -> bool:
    """Send a message via Telegram Bot API with retry logic.

    Returns True on success, False if permanently blocked or all retries failed.
    - 429 Too Many Requests: back off using retry_after
    - 403 Forbidden: bot is blocked by user, stop immediately
    - Other errors: retry up to max 3 attempts
    """
    url = _TELEGRAM_API.format(token=bot_token)
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": True,
    }

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            resp = requests.post(url, json=payload, timeout=15)
        except requests.RequestException as exc:
            print(f"[telegram] Network error on attempt {attempt}: {exc}")
            if attempt < _MAX_ATTEMPTS:
                time.sleep(2 ** attempt)
            continue

        if resp.status_code == 200:
            return True

        if resp.status_code == 403:
            # Bot blocked by user — no point retrying
            print(f"[telegram] 403 Forbidden for chat_id={chat_id}: bot is blocked")
            return False

        if resp.status_code == 429:
            retry_after = 30
            try:
                data = resp.json()
                retry_after = data.get("parameters", {}).get("retry_after", 30)
            except Exception:
                pass
            print(f"[telegram] 429 rate-limited, waiting {retry_after}s (attempt {attempt})")
            time.sleep(retry_after)
            continue

        # Other HTTP errors
        print(
            f"[telegram] HTTP {resp.status_code} on attempt {attempt} for chat_id={chat_id}: {resp.text[:200]}"
        )
        if attempt < _MAX_ATTEMPTS:
            time.sleep(2 ** attempt)

    print(f"[telegram] All {_MAX_ATTEMPTS} attempts failed for chat_id={chat_id}")
    return False


def split_message(text: str, max_len: int = 4096) -> list[str]:
    """Split a long message into chunks at line boundaries, each <= max_len chars."""
    if len(text) <= max_len:
        return [text]

    parts: list[str] = []
    current_lines: list[str] = []
    current_len = 0

    for line in text.splitlines(keepends=True):
        line_len = len(line)
        # If a single line exceeds max_len, hard-split it
        if line_len > max_len:
            # flush current buffer first
            if current_lines:
                parts.append("".join(current_lines))
                current_lines = []
                current_len = 0
            # hard split the oversized line
            for i in range(0, line_len, max_len):
                parts.append(line[i : i + max_len])
            continue

        if current_len + line_len > max_len:
            parts.append("".join(current_lines))
            current_lines = [line]
            current_len = line_len
        else:
            current_lines.append(line)
            current_len += line_len

    if current_lines:
        parts.append("".join(current_lines))

    return parts
