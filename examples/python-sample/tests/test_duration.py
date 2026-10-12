import pytest

from textkit import parse_duration


@pytest.mark.parametrize(
    "text, seconds",
    [
        ("45s", 45),
        ("5m", 300),
        ("2h", 7200),
        ("1d", 86400),
        ("1h30m", 5400),
        ("1d2h3m4s", 93784),
        ("30m1h", 5400),
        ("1h 30m", 5400),
        (" 90s ", 90),
        ("0s", 0),
    ],
)
def test_valid(text, seconds):
    assert parse_duration(text) == seconds


@pytest.mark.parametrize("text", ["", "   ", "abc", "10", "h", "1x", "1h1h", "-5m", "1.5h", "1h 30"])
def test_invalid_raises_value_error(text):
    with pytest.raises(ValueError):
        parse_duration(text)
