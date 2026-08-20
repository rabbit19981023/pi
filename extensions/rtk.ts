// RTK Pi extension — rewrites bash commands to use rtk for token savings.
// Requires: rtk >= 0.23.0 in PATH.
//
// This is a thin delegating extension: all rewrite logic lives in `rtk rewrite`,
// which is the single source of truth (src/discover/registry.rs).
// To add or change rewrite rules, edit the Rust registry — not this file.
//
// Exit code contract for `rtk rewrite`:
//   0 + stdout  Rewrite found → mutate command
//   1           No RTK equivalent → pass through unchanged
//   3 + stdout  Rewrite (advisory) → mutate command
//
// patch: also intercepts context-mode MCP sandbox shell (mcp wrapper).
// Fixed: exact tool matching (excludes ctx_execute_file), args object/string
// compatible, parallel batch rewrite, trimStart rtk guard, fail-open.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { isToolCallEventType } from "@earendil-works/pi-coding-agent"

const REWRITE_TIMEOUT_MS = 2_000
const MIN_SUPPORTED_RTK_MINOR = 23

// Parse "X.Y.Z" semver, return [major, minor, patch] or null.
function parseSemver(raw: string): [number, number, number] | null {
  const m = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
}

// Calls `rtk rewrite`; returns the rewritten command or null (pass through).
async function rewriteCommand(
  pi: ExtensionAPI,
  cmd: string,
  signal?: AbortSignal
): Promise<string | null> {
  const result = await pi.exec("rtk", ["rewrite", cmd], {
    timeout: REWRITE_TIMEOUT_MS,
    signal,
  })
  if (result.killed) return null
  if (result.code !== 0 && result.code !== 3) return null
  return result.stdout.trim() || null
}

// Pipe-aware wrapper: `rtk rewrite` fails on `git ... | head` (exit 1), but
// `rtk git ... | head` still saves tokens. Try whole-command rewrite first,
// then fall back to per-pipe-segment rewrite. Also handles `;`-compounds
// where only the piped segment was left un-rewritten.
async function rewriteSmart(
  pi: ExtensionAPI,
  cmd: string,
  signal?: AbortSignal
): Promise<string | null> {
  const direct = await rewriteCommand(pi, cmd, signal)
  // If whole command rewritten, still fix any remaining `| git` segments
  // that `rtk rewrite` left untouched (e.g. `rtk git diff --stat; git diff | head`).
  const base = direct ?? cmd
  // No pipe or semicolon etc. -> nothing to fix beyond direct
  if (!/[|;]/.test(base)) return direct
  // Split on ;, |, &&, || keeping delimiters so we can rewrite each
  // command segment. This fixes `a; git diff | head` where whole-command
  // rewrite left the piped part untouched.
  const parts = base.split(/(\s*(?:&&|\|\||;|\|)\s*)/)
  let changed = false
  const rewrittenParts: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i % 2 === 1) {
      rewrittenParts.push(part) // delimiter
      continue
    }
    const trimmed = part.trim()
    if (!trimmed || trimmed.trimStart().startsWith("rtk ")) {
      rewrittenParts.push(part)
      continue
    }
    const r = await rewriteCommand(pi, trimmed, signal)
    if (r && r !== trimmed) {
      changed = true
      const leading = part.match(/^\s*/)?.[0] ?? ""
      const trailing = part.match(/\s*$/)?.[0] ?? ""
      rewrittenParts.push(leading + r + trailing)
    } else {
      rewrittenParts.push(part)
    }
  }
  if (changed) return rewrittenParts.join("")
  return direct
}

// Exact match for context-mode sandbox shell tools, excludes ctx_execute_file.
// Handles raw names like "ctx_execute", "context-mode_ctx_execute", "default.ctx_execute".
function isCtxTool(name: string): boolean {
  if (name.includes("ctx_execute_file")) return false
  return (
    name === "ctx_execute" ||
    name === "ctx_batch_execute" ||
    name.endsWith(".ctx_execute") ||
    name.endsWith("_ctx_execute") ||
    name.endsWith(".ctx_batch_execute") ||
    name.endsWith("_ctx_batch_execute")
  )
}

export default async function (pi: ExtensionAPI) {
  // Probe rtk version at load time; disables extension if missing or too old.
  const ver = await pi.exec("rtk", ["--version"], { timeout: REWRITE_TIMEOUT_MS })
  if (ver.code !== 0) {
    console.warn("[rtk] rtk binary not found in PATH — extension disabled")
    return
  }

  // Warn and bail if rtk predates 0.23.0 (when `rtk rewrite` was introduced).
  const parsed = parseSemver(ver.stdout.replace(/^rtk\s+/, ""))
  if (parsed) {
    const [major, minor] = parsed
    if (major === 0 && minor < MIN_SUPPORTED_RTK_MINOR) {
      console.warn(`[rtk] rtk ${ver.stdout.trim()} is too old (need >= 0.23.0) — extension disabled`)
      return
    }
  }

  pi.on("tool_call", async (event, ctx) => {
    try {
      if (process.env.RTK_DISABLED === "1") return

      // --- bash (original) ---
      if (isToolCallEventType("bash", event)) {
        const cmd = event.input.command
        if (typeof cmd !== "string" || cmd.trim() === "") return
        if (cmd.trimStart().startsWith("rtk ")) return
        const rewritten = await rewriteSmart(pi, cmd, ctx.signal)
        if (rewritten && rewritten !== cmd) {
          event.input.command = rewritten
        }
        return
      }

      // --- context-mode MCP wrapper: toolName is "mcp", real tool in input.tool ---
      const rawToolName = String((event as any).toolName ?? "")
      const rawInput: any = (event as any).input ?? {}
      let targetTool = rawToolName
      let targetArgs: any = rawInput
      let isMcpWrapper = false
      let argsWasString = false
      if (rawToolName === "mcp" && typeof rawInput?.tool === "string") {
        targetTool = rawInput.tool
        isMcpWrapper = true
        const a: any = rawInput.args
        argsWasString = typeof a === "string"
        try {
          targetArgs = argsWasString ? JSON.parse(a) : (a ?? {})
        } catch {
          console.warn("[rtk] bad mcp args JSON", a)
          targetArgs = {}
        }
      }

      if (!isCtxTool(targetTool)) return

      let mutated = false

      // ctx_execute: {language, code}
      if (
        typeof targetArgs.code === "string" &&
        targetArgs.language === "shell" &&
        targetArgs.code.trim() &&
        !targetArgs.code.trimStart().startsWith("rtk ")
      ) {
        const rewritten = await rewriteSmart(pi, targetArgs.code, ctx.signal)
        if (rewritten && rewritten !== targetArgs.code) {
          targetArgs.code = rewritten
          if (!isMcpWrapper) (event as any).input.code = rewritten
          mutated = true
        }
      }

      // ctx_batch_execute: {commands: [{command}]}
      if (Array.isArray(targetArgs.commands)) {
        const jobs = targetArgs.commands.map(async (c: any) => {
          if (
            typeof c.command !== "string" ||
            !c.command.trim() ||
            c.command.trimStart().startsWith("rtk ")
          )
            return false
          const r = await rewriteSmart(pi, c.command, ctx.signal)
          if (r && r !== c.command) {
            c.command = r
            return true
          }
          return false
        })
        const results = await Promise.all(jobs)
        if (results.some(Boolean)) mutated = true
      }

      if (mutated && isMcpWrapper) {
        (event as any).input.args = argsWasString ? JSON.stringify(targetArgs) : targetArgs
      }
      // non-wrapper: targetArgs is same reference as event.input, mutation already visible
    } catch (err) {
      // Fail open: never block execution on an unexpected error.
      console.warn("[rtk] unexpected error in tool_call handler; passing through command", err)
      return
    }
  })
}
