# textkit: a Diby sample project

A tiny Python package for trying out [Diby](../../README.md). `slugify` and `word_count` are done.
`parse_duration` in `textkit/duration.py` is a stub the "agent" handed to you, with tests waiting in
`tests/test_duration.py`.

## Try it without an agent

1. Open this folder (`examples/python-sample`) in VS Code with the Diby extension running
   (press F5 from the repo root to launch an Extension Development Host).
2. Run **Diby: Start Demo Challenge** from the command palette. It loads `.diby/demo-challenge.json`.
3. Implement `parse_duration`, then press **Run tests** in the Challenge panel or the CodeLens.
4. When everything passes, Diby captures your code and asks for an optional one-line reflection.

## Try it with a real agent

1. Run **Diby: Connect Agents** and pick your agent.
2. Ask it for something with a self-contained helper, for example: "add a `--timeout 1h30m` flag to the CLI".
3. If Diby's frequency policy says yes, you get an offer to write the function yourself.

## Run the tests by hand

```sh
uv run --with pytest pytest -q
```

Until `parse_duration` is implemented, the duration tests fail with `NotImplementedError`.
