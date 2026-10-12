from textkit import slugify, word_count


def test_slugify():
    assert slugify("Hello, World!") == "hello-world"
    assert slugify("  Crème brûlée  ") == "creme-brulee"


def test_word_count():
    assert word_count("a b  c\n d") == 4
    assert word_count("") == 0
