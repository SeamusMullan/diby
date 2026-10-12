"""Duration helpers."""


def parse_duration(text: str) -> int:
    """Convert a human duration such as ``"1h30m"`` into whole seconds.

    Supports the units ``d``, ``h``, ``m`` and ``s`` in any order, each at most once,
    with optional whitespace between parts. Raises ``ValueError`` for anything else.
    """
    raise NotImplementedError("DIBY: parse_duration")
