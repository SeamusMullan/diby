"""Small, already-implemented text helpers."""
import re
import unicodedata


def slugify(text: str) -> str:
    """Lowercase ``text`` and join its alphanumeric runs with single hyphens."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return "-".join(re.findall(r"[a-z0-9]+", ascii_text.lower()))


def word_count(text: str) -> int:
    """Count whitespace-separated words."""
    return len(text.split())
