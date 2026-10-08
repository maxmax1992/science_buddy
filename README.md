# Science Buddy

Read papers with a tutor: highlight a passage, ask by text or voice, and every answer stays pinned to the text as an underline you can click to reopen.

- **Claude only, via your subscription**: everything runs through the logged-in Claude Code CLI (`ai-sdk-provider-claude-code`); no API keys.
- **Transcription**: each paper is transcribed once by Claude into Markdown + LaTeX (3 pages per call, cached per chunk; papers are content-addressed, so re-adding never re-transcribes).
- **Side chat**: streamed answers with math, Mermaid diagrams, sandboxed interactive HTML visualizations, and every tool call (Read/Grep/WebSearch/WebFetch) inspectable.
- **Related papers**: Claude can call `add_related_paper` to pull a cited work into your library under the current paper.
- **Local voice**: Parakeet v3 (ASR) and Kokoro-82M (TTS) on Apple Silicon via `mlx-audio`.

## Run

```bash
claude auth login   # once, if Claude Code isn't logged in
npm install
npm run voice       # local ASR/TTS server on :8765 (first run downloads models)
npm run dev         # http://localhost:3000
```

Data lives in `data/papers/<id>/` (`paper.pdf`, `meta.json`, `chunks/`, `transcript.md`, `threads/*.json`). Optional overrides are listed in `.env.example`.

## e2e tests

[TesterArmy e2e](https://e2e.tester.army). `agent.act` / `agent.assert` steps run on Claude through the subscription via a custom executor (`tests/claude-executor.ts`: Haiku picks actions, Sonnet judges assertions), since e2e's built-in agent needs an API model.

Tests run against their own server on :3100 with their own library (`.e2e/data`) and a 2-page fixture paper, so they never touch your papers or threads. The runner starts that server itself; keep `npm run voice` running for the voice test.

```bash
npm run test:e2e                       # all tests
npx e2e run --grep "rejects input"     # one test
```

There is no CI: run the suite locally before pushing to `main`. Skip tags with `--exclude-tag voice` or `--exclude-tag claude`.
