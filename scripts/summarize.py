"""AI summarization for AI Digest pipeline."""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from sources import Article

_PROMPTS_DIR = Path(__file__).parent / "prompts"


@dataclass
class FeaturedItem:
    title: str
    summary: str
    url: str
    why: str = ""


@dataclass
class QuickBite:
    title: str
    url: str


@dataclass
class DigestResult:
    featured: list[FeaturedItem]
    quick_bites: list[QuickBite]
    is_empty: bool


def build_prompt(
    articles: list[Article],
    topics: str,
    lang: str = "English",
    style: str = "mixed",
) -> str:
    """Read template and format with articles/topics/lang/style."""
    template_path = _PROMPTS_DIR / "digest_prompt.txt"
    template = template_path.read_text(encoding="utf-8")

    articles_text = "\n".join(
        f"- [{a.source}] {a.title} — {a.url}"
        + (f"\n  Summary: {a.summary[:200]}" if a.summary else "")
        for a in articles
    )

    return template.format(
        topics=topics,
        lang=lang,
        style=style,
        articles=articles_text,
    )


_MAX_ARTICLES_FOR_PROMPT = 50


def _balance_by_source(articles: list[Article], limit: int) -> list[Article]:
    """Select articles balanced across sources, taking newest first per source."""
    from collections import defaultdict

    by_source: dict[str, list[Article]] = defaultdict(list)
    for a in articles:
        by_source[a.source].append(a)

    sources = list(by_source.keys())
    if not sources:
        return []

    # Round-robin: take one from each source at a time until we hit the limit
    result: list[Article] = []
    idx = {s: 0 for s in sources}
    while len(result) < limit:
        added = False
        for s in sources:
            if idx[s] < len(by_source[s]):
                result.append(by_source[s][idx[s]])
                idx[s] += 1
                added = True
                if len(result) >= limit:
                    break
        if not added:
            break
    return result


def call_copilot_cli(prompt: str) -> str:
    """Call GitHub Copilot CLI via stdin pipe and return the response."""
    try:
        result = subprocess.run(
            ["copilot", "--model", "gpt-5-mini", "-s", "--no-color"],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"copilot cli exited with code {result.returncode}: {result.stderr}"
            )
        return result.stdout
    except subprocess.TimeoutExpired:
        raise RuntimeError("copilot cli timed out after 120s")
    except FileNotFoundError:
        raise RuntimeError("copilot cli not found; install with: npm i -g @github/copilot")


def parse_digest_response(response: str) -> DigestResult:
    """Extract JSON from AI response (may be wrapped in markdown code blocks)."""
    # Strip markdown code fences if present
    text = response.strip()
    # Match ```json ... ``` or ``` ... ```
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence_match:
        text = fence_match.group(1).strip()

    # Try to find JSON object if there's surrounding prose
    obj_match = re.search(r"\{[\s\S]*\}", text)
    if obj_match:
        text = obj_match.group(0)

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse digest JSON: {exc}\nRaw: {response[:500]}")

    is_empty = data.get("is_empty", False)
    featured = [
        FeaturedItem(
            title=item.get("title", ""),
            summary=item.get("summary", ""),
            url=item.get("url", ""),
            why=item.get("why", ""),
        )
        for item in data.get("featured", [])
    ]
    quick_bites = [
        QuickBite(title=item.get("title", ""), url=item.get("url", ""))
        for item in data.get("quick_bites", [])
    ]
    return DigestResult(featured=featured, quick_bites=quick_bites, is_empty=is_empty)


def summarize_articles(
    articles: list[Article],
    topics: str,
    lang: str = "English",
    style: str = "mixed",
) -> DigestResult:
    """Full summarization pipeline: build prompt -> call AI -> parse response."""
    # Balance articles across sources so no single source dominates
    articles = _balance_by_source(articles, _MAX_ARTICLES_FOR_PROMPT)
    prompt = build_prompt(articles, topics=topics, lang=lang, style=style)
    response = call_copilot_cli(prompt)
    return parse_digest_response(response)


def format_telegram_message(digest: DigestResult, date: str, style: str) -> str:
    """Format DigestResult as a Telegram message (max 4096 chars). Returns '' if empty."""
    if digest.is_empty:
        return ""

    lines: list[str] = []

    if style == "brief":
        lines.append(f"*AI Digest — {date}*\n")
        for bite in digest.quick_bites:
            lines.append(f"• [{bite.title}]({bite.url})")
        for item in digest.featured:
            lines.append(f"• [{item.title}]({item.url})")
    elif style == "deep":
        lines.append(f"*AI Digest — {date}*\n")
        for item in digest.featured:
            lines.append(f"*{item.title}*")
            lines.append(item.summary)
            if item.why:
                lines.append(f"_Why it matters: {item.why}_")
            lines.append(item.url)
            lines.append("")
    else:
        # mixed (default)
        lines.append(f"*AI Digest — {date}*\n")
        if digest.featured:
            lines.append("*Featured*")
            for item in digest.featured:
                lines.append(f"\n*{item.title}*")
                lines.append(item.summary)
                if item.why:
                    lines.append(f"_Why: {item.why}_")
                lines.append(item.url)
        if digest.quick_bites:
            lines.append("\n*Quick Bites*")
            for bite in digest.quick_bites:
                lines.append(f"• [{bite.title}]({bite.url})")

    message = "\n".join(lines)

    # Truncate to 4096 chars if needed (trim at last newline before limit)
    if len(message) > 4096:
        truncated = message[:4090]
        cut = truncated.rfind("\n")
        if cut > 0:
            truncated = truncated[:cut]
        message = truncated + "\n…"

    return message
