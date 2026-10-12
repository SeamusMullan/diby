/**
 * MODULE connect — the instructions that teach coding agents how to use Diby well.
 */

/** Markdown for the Diby section of AGENTS.md (without the diby:start / diby:end markers). */
export function buildAgentsSnippet(): string {
  return `## Diby: hand functions back to the human

Diby is a VS Code extension that lets you offer a function to the human as a practice exercise. You write the stub and the tests, the human writes the implementation, the tests run, and you get their code back. The MCP tools are \`diby_preferences\`, \`diby_delegate\`, \`diby_wait\` and \`diby_cancel\`. Diby only works while VS Code is open with the extension running. If a tool says Diby is not running, implement the function yourself and carry on.

### When to delegate

- Delegate only self-contained functions of roughly 5 to 40 lines with educational value: parsing, algorithms, data transforms, validation, string or date handling, small state machines.
- Never delegate glue code, boilerplate, config, wiring, I/O plumbing, UI code, or anything whose behaviour you cannot pin down with fast, deterministic tests.
- Offer at most one function at a time, and do not delegate when the user asked you to be fast or to avoid interruptions.
- Call \`diby_preferences\` once per session, before your first delegation. It returns the user's mode, focus and avoid concepts and maximum difficulty. Respect them: prefer focus concepts, skip avoided ones, never exceed the maximum difficulty. If the mode is \`off\`, never delegate.

### How to delegate

1. Write the stub in the real file, with the final signature and a docstring. In Python the body is exactly \`raise NotImplementedError("DIBY: <symbol>")\`. Other languages: any clearly unimplemented body containing the text \`DIBY\`.
2. Write focused tests before you call Diby. Cover the normal cases, edge cases and error cases named in your spec. The tests must fail on the stub and pass on a correct implementation.
3. Make \`testCommand\` run only the tests for this function (for example \`pytest tests/test_duration.py -q\`), never the whole suite.
4. Call \`diby_delegate\` with \`file\`, \`range\` (1-based inclusive lines of the whole stubbed function, signature included), \`symbol\`, \`signature\`, \`spec\` (markdown: behaviour, inputs, outputs, edge cases, examples; do not give away the solution), \`testCommand\`, \`testFiles\`, \`language\`, \`concepts\` (lowercase kebab-case), \`difficulty\` (1 to 5) and optionally \`referenceSolution\` (shown to the human only after they finish).
5. Keep working on unrelated tasks while you wait.

### Handling the result

- The response status is \`pending\` or \`declined_by_policy\`. For \`declined_by_policy\`, implement the function yourself immediately. Do not retry or argue with the policy.
- While \`pending\` or \`active\`, call \`diby_wait\` with the id (\`timeoutSec\` of 30 or less). It returns after at most that long, so call it again until the status is terminal. Do other useful work between calls.
- \`declined\`, \`declined_by_policy\`, \`gave_up\` and \`cancelled\`: implement the function yourself, as if you had never delegated.
- \`passed\`: the human's code is already in the file and the tests passed. Integrate it verbatim. Do not rewrite, refactor, rename, reformat or "improve" it, even if you would have written it differently. Build the rest of the work around it. If you notice a genuine bug, tell the user instead of silently changing their code. Read any \`reflection\` or \`notes\` they left.
- Never edit the function's region (or its tests) while the challenge is \`pending\` or \`active\`. Use \`diby_cancel\` first if you must change plans.

### Example

The user asks for a CLI that accepts durations like \`1h30m\`. You write the argument parsing and CLI wiring yourself. \`parse_duration\` is a good candidate: it is self-contained, about 20 lines, and has clear edge cases. You add \`def parse_duration(text: str) -> int:\` with the body \`raise NotImplementedError("DIBY: parse_duration")\`, write \`tests/test_duration.py\`, then call \`diby_delegate\` with \`testCommand: "pytest tests/test_duration.py -q"\`, \`concepts: ["parsing"]\` and \`difficulty: 2\`. You then poll \`diby_wait\` while wiring up the CLI. On \`passed\` you call the human's function exactly as written.`;
}
