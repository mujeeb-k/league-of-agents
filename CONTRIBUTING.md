# Contributing

Thanks for helping. League of Agents is a canvas for steering coding agents and reviewing their work: a web app (`web/`) and a local bridge (`bridge/loa.mjs`).

## Before you start
- For anything larger than a small fix, open an issue first, to agree on the change before you spend time on it.
- Security problems go through [SECURITY.md](SECURITY.md), never a public issue.
- Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Set up

You need macOS (Windows and Linux are coming), Node 20 or later, and git.

```bash
npm --prefix web ci
npm --prefix web run build
```

Run the bridge in any git repository with a stand-in agent, so nothing calls a real one:

```bash
cd /path/to/some/repo
LOA_CLAUDE_BIN=/path/to/league-of-agents/tests/fixtures/fake-claude.mjs node /path/to/league-of-agents/bridge/loa.mjs serve
```

`web/README.md` explains the app's structure and every test suite.

## Before you open a pull request
- `npm --prefix web run check`: formatting, lint, types and unit tests.
- `npm --prefix web test`: the build and the Playwright suites, when you changed the app, the bridge or tests.
- Visual changes: both themes, and a screenshot in the pull request.
- Keep each pull request to one concern, and say how you checked it.

## Conventions
- The bridge has no runtime dependencies and runs on Node's built-ins only.
- The bridge never commits to your branch or touches staging; snapshots go only to private `refs/loa/` refs.
- Sentence case in all interface text, and plain words: say what happened and what to do.
- No dead or commented-out code, debug logs or stray TODOs.
- `docs/DESIGN.md` is the visual standard; `docs/ARCHITECTURE.md` describes how it is built.

## License

League of Agents is licensed under the [Apache License 2.0](LICENSE). Contributions are accepted under the same license, as its section 5 sets out: anything you submit for inclusion is licensed under Apache 2.0, with no separate agreement to sign. You keep the copyright to your work.
