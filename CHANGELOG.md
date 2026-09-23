# Changelog

## 0.1.2

- Default to Claude CLI `2.1.280`; environment and agent-home overrides retain precedence.

## 0.1.1, vincecity fork

- Default to Claude CLI `2.1.258`.
- Read `cliVersion` from the active Pi home's `pi-claude-auth.json`, with
  `ANTHROPIC_CLI_VERSION` taking precedence.
- Snapshot version and entrypoint per extension load for matching user-agent
  and billing headers without request-time config reads.
- Support Pi 0.85's credential store while retaining the older AuthStorage path.
- Distribute through Pi's pinned Git package support. No npm release.

# [0.1.0](https://github.com/pankajudhas81/pi-claude-auth/compare/v0.0.1...v0.1.0) (2026-05-30)

## 0.0.1

### Features

- Initial release. Pi coding agent extension that authenticates against
  Anthropic using your existing Claude Code credentials — no separate login
  or API key needed.
- Reads OAuth credentials from the macOS Keychain (all
  `Claude Code-credentials*` entries) with automatic multi-account detection,
  falling back to `~/.claude/.credentials.json` on all platforms.
- Seeds and syncs credentials into pi's `~/.pi/agent/auth.json` so pi uses
  them with zero separate login. Background re-sync runs every 5 minutes.
- Refreshes expiring tokens directly via Anthropic's OAuth endpoint (zero LLM
  tokens consumed), falling back to the Claude CLI, and writes rotated tokens
  back to the Keychain or credentials file.
- Account switcher via `/login anthropic` when multiple Claude Code accounts
  are detected; selection persists across sessions.
- Diagnostic logging via `PI_CLAUDE_AUTH_DEBUG` with automatic secret
  redaction.
