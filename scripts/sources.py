"""Source fetching for AI Digest pipeline."""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

import feedparser
import requests

DEFAULT_FEEDS: dict[str, str] = {
    "huggingface": "https://huggingface.co/blog/feed.xml",
    "openai": "https://openai.com/blog/rss.xml",
    "simonw": "https://simonwillison.net/atom/everything/",
    "techcrunch-ai": "https://techcrunch.com/category/artificial-intelligence/feed/",
    "mit-tech-review": "https://www.technologyreview.com/feed/",
    "the-verge-ai": "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    "ars-technica": "https://feeds.arstechnica.com/arstechnica/technology-lab",
}

_TRACKING_PREFIXES = ("utm_", "fbclid", "gclid", "mc_", "ref_", "source_")


@dataclass
class Article:
    title: str
    url: str
    source: str
    summary: str = ""
    published: str = ""


def normalize_url(url: str) -> str:
    """Strip tracking query params and trailing slash from URL."""
    parsed = urlparse(url)
    # Filter out tracking params
    clean_params = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if not any(k.startswith(prefix) for prefix in _TRACKING_PREFIXES)
    ]
    clean_query = urlencode(clean_params)
    path = parsed.path.rstrip("/") if parsed.path != "/" else parsed.path
    cleaned = urlunparse(
        (parsed.scheme, parsed.netloc, path, parsed.params, clean_query, "")
    )
    return cleaned


def url_hash(url: str) -> str:
    """Return first 16 chars of SHA-256 of the normalized URL."""
    normalized = normalize_url(url)
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def deduplicate_articles(articles: list[Article]) -> list[Article]:
    """Deduplicate articles by normalized URL hash, keeping first occurrence."""
    seen: set[str] = set()
    result: list[Article] = []
    for article in articles:
        h = url_hash(article.url)
        if h not in seen:
            seen.add(h)
            result.append(article)
    return result


def parse_feed_entries(xml: str, source_name: str) -> list[Article]:
    """Parse RSS/Atom XML string and return list of Articles."""
    feed = feedparser.parse(xml)
    articles: list[Article] = []
    for entry in feed.entries:
        title = entry.get("title", "").strip()
        # Atom uses link href, RSS uses link text
        link = entry.get("link", "")
        if not link:
            # Try links list
            for lnk in entry.get("links", []):
                if lnk.get("rel") == "alternate" or lnk.get("href"):
                    link = lnk.get("href", "")
                    break
        summary = entry.get("summary", "") or entry.get("description", "")
        published = entry.get("published", "") or entry.get("updated", "")
        if title and link:
            articles.append(
                Article(
                    title=title,
                    url=link,
                    source=source_name,
                    summary=summary,
                    published=published,
                )
            )
    return articles


def fetch_feed(name: str, url: str) -> list[Article]:
    """Fetch a single RSS/Atom feed and return articles."""
    try:
        resp = requests.get(url, timeout=10, headers={"User-Agent": "ai-digest-bot/1.0"})
        resp.raise_for_status()
        return parse_feed_entries(resp.text, name)
    except Exception as exc:
        print(f"[sources] Failed to fetch feed {name} ({url}): {exc}")
        return []


def fetch_hn_top(limit: int = 30) -> list[Article]:
    """Fetch top stories from Hacker News Firebase API."""
    try:
        resp = requests.get(
            "https://hacker-news.firebaseio.com/v0/topstories.json",
            timeout=10,
        )
        resp.raise_for_status()
        ids: list[int] = resp.json()[:limit]
    except Exception as exc:
        print(f"[sources] Failed to fetch HN top IDs: {exc}")
        return []

    articles: list[Article] = []
    for story_id in ids:
        try:
            item_resp = requests.get(
                f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json",
                timeout=10,
            )
            item_resp.raise_for_status()
            item = item_resp.json()
            url = item.get("url", "")
            title = item.get("title", "")
            if url and title:
                articles.append(
                    Article(
                        title=title,
                        url=url,
                        source="hn",
                        summary="",
                        published="",
                    )
                )
        except Exception as exc:
            print(f"[sources] Failed to fetch HN item {story_id}: {exc}")
    return articles


def fetch_arxiv(categories: list[str], max_results: int = 20) -> list[Article]:
    """Fetch recent papers from arXiv API with 3s delay between categories."""
    articles: list[Article] = []
    for i, cat in enumerate(categories):
        if i > 0:
            time.sleep(3)
        try:
            url = (
                f"https://export.arxiv.org/api/query"
                f"?search_query=cat:{cat}&sortBy=submittedDate"
                f"&sortOrder=descending&max_results={max_results}"
            )
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            entries = parse_feed_entries(resp.text, f"arxiv-{cat}")
            articles.extend(entries)
        except Exception as exc:
            print(f"[sources] Failed to fetch arXiv category {cat}: {exc}")
    return articles


def fetch_all_sources(custom_feeds: Optional[dict[str, str]] = None) -> list[Article]:
    """Fetch all default feeds + custom feeds + HN + arXiv, then deduplicate."""
    all_articles: list[Article] = []

    # Default feeds
    feeds = dict(DEFAULT_FEEDS)
    if custom_feeds:
        feeds.update(custom_feeds)

    for name, url in feeds.items():
        all_articles.extend(fetch_feed(name, url))

    # Hacker News
    all_articles.extend(fetch_hn_top(limit=30))

    # arXiv AI-related categories
    all_articles.extend(fetch_arxiv(["cs.AI", "cs.LG", "cs.CL"], max_results=20))

    return deduplicate_articles(all_articles)
