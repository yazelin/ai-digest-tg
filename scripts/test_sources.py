from sources import normalize_url, deduplicate_articles, parse_feed_entries, Article


def test_normalize_url_strips_tracking():
    assert normalize_url("https://example.com/post?utm_source=twitter&id=1") == "https://example.com/post?id=1"


def test_normalize_url_strips_trailing_slash():
    assert normalize_url("https://example.com/post/") == "https://example.com/post"


def test_deduplicate_articles():
    articles = [
        Article(title="A", url="https://example.com/a", source="hn"),
        Article(title="A dup", url="https://example.com/a", source="tc"),
        Article(title="B", url="https://example.com/b", source="hn"),
    ]
    result = deduplicate_articles(articles)
    assert len(result) == 2


def test_parse_feed_entries_returns_articles():
    xml = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Test Post</title><link href="https://example.com/test"/><summary>A test summary</summary></entry></feed>'
    articles = parse_feed_entries(xml, "test-source")
    assert len(articles) == 1
    assert articles[0].title == "Test Post"
