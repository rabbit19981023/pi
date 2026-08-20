# Pi — Efficient Execution

**Goal: Pick the right tool the first time.** Small outputs via `bash` (rtk auto-compresses 60-99%), large outputs via `context-mode` sandbox (99% saved).

## When to Use What

- **Small <20 lines**: `ls` `find` `grep` `wc` `git status` → `bash` directly
- **Large / compute needed**: `git log` `cat large file` `npm test` `analyze logs/CSV` → `ctx_execute` / `ctx_batch_execute` (compute inside sandbox, return summary only)
- **Reading files**: to analyze → `ctx_execute_file`; to edit → `read`
- **Multiple commands / sources**: batch in parallel → `ctx_batch_execute` `concurrency: 4-5`; multiple URLs → `ctx_fetch_and_index` `concurrency: 4-5`
- **Web**: instant answer → `web_search`; need persistent searchable index → `ctx_fetch_and_index` → `ctx_search`
- **Knowledge graph**: if `graphify-out/graph.json` exists, prefer `graphify query / path / explain`

## Principles

- **Think in Code**: run `console.log()` inside the sandbox and return only the answer — never dump raw large files into the conversation
- **Write to file, don't flood context**: always write large results to a file, return path + one-line summary
- **When in doubt, use sandbox**: if output size is unknown, default to `ctx_execute`
