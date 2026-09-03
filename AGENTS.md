# AGENTS.md — global defaults (repo AGENTS.md overrides this)

## Constitution

- Ship behavior change with docs in the same commit.
- Docs vs implementation conflict: ask the user, never pick silently.
- Docs first; code implements docs.
- Simple, minimal dependencies; never reinvent stdlib / mature tools.
- Test first at agreed seams (see repo AGENTS.md; if none listed, ask); new or changed seam: confirm with user first.

## Execution (small, local, verifiable each step)

- One small change per step; state how you'll verify before acting, verify output before continuing.
- Pick the tool right the first time:
  - Small (<20 lines) with known output size -> `bash`.
  - Large output -> `ctx_execute` (compute inside, summary only).
  - Analyze file -> `ctx_execute_file`; to edit, `read` to locate first, then call `edit`.
  - Multiple items -> `ctx_batch_execute` (concurrency 4-5).
  - Multiple URLs to keep -> `ctx_fetch_and_index`.
  - Throwaway lookup -> `web_search`; keep for reuse across sessions -> `ctx_search`.
  - `graphify-out/graph.json` exists -> query the graph first.
- Never flood context: large results go to a file; return path + one-line summary. Unknown size -> always compute inside `ctx_execute`, return summary only.
- Human-only steps (credentials, third-party, auth) -> use wizard; never fake completion.
- Commit: follow `.gitmessage` if present, else repo AGENTS.md; if neither defines it, ask.
