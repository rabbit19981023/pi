# AGENTS.md — global defaults

Precedence: global AGENTS.md > repo AGENTS.md > path/module AGENTS.md
If instructions conflict and precedence doesn't resolve it, stop and ask

## Constitution

- Ship behavior change with docs in the same commit.
- Docs vs implementation conflict: ask the user, never pick silently.
- Docs first; code implements docs.
- Protect existing contracts: never silently change public behavior, APIs, data formats, or module seams.
- Simple, minimal dependencies; never reinvent stdlib / mature tools.
- Test at seams declared by the repo; if none are, ask before choosing.

## Execution (small, local, verifiable each step)

- One small change per step; state how you'll verify before acting, verify output before continuing.
- Don't batch unrelated changes into one step.
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
