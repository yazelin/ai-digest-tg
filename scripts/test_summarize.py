from summarize import format_telegram_message, DigestResult, FeaturedItem, QuickBite


def test_format_mixed():
    digest = DigestResult(
        featured=[FeaturedItem(title="Test Article", summary="A great article.", url="https://example.com/a", why="Important")],
        quick_bites=[QuickBite(title="Quick one", url="https://example.com/b")],
        is_empty=False,
    )
    msg = format_telegram_message(digest, "2026-03-12", "mixed")
    assert "Test Article" in msg
    assert "https://example.com/a" in msg
    assert len(msg) <= 4096


def test_format_empty():
    digest = DigestResult(featured=[], quick_bites=[], is_empty=True)
    msg = format_telegram_message(digest, "2026-03-12", "mixed")
    assert msg == ""


def test_format_brief():
    digest = DigestResult(
        featured=[],
        quick_bites=[QuickBite(title="Item 1", url="https://example.com/1"), QuickBite(title="Item 2", url="https://example.com/2")],
        is_empty=False,
    )
    msg = format_telegram_message(digest, "2026-03-12", "brief")
    assert "Item 1" in msg
