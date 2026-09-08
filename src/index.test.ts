import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mock, test } from "node:test"
import type {
    ExtensionAPI,
    ProviderConfig,
} from "@earendil-works/pi-coding-agent"

// The factory is exercised without reading credentials, starting timers, or
// contacting a provider. Signing and config resolution remain real.
const creds = {
    accessToken: "fixture",
    refreshToken: "fixture",
    expiresAt: Infinity,
}
mock.module("./credentials.ts", {
    namedExports: {
        forceRefreshActiveCredentials: () => creds,
        getCachedCredentials: () => creds,
        getCredentialsForSync: () => creds,
        initAccounts: () => {},
        loadPersistedAccountSource: () => undefined,
        refreshAccountsList: () => [],
        saveAccountSource: () => {},
        setActiveAccountSource: () => {},
        syncAuthJson: () => {},
    },
})
mock.module("./keychain.ts", {
    namedExports: {
        readAllClaudeAccounts: () => [
            { source: "fixture", label: "fixture", credentials: creds },
        ],
    },
})
mock.module("./logger.ts", {
    namedExports: { initLogger: () => {}, log: () => {} },
})
const { default: extension } = await import("./index.ts")

test("factory snapshots matching UA and billing per home, without request-time reads", async () => {
    const original = { ...process.env }
    const dirs = [
        mkdtempSync(join(tmpdir(), "auth-a-")),
        mkdtempSync(join(tmpdir(), "auth-b-")),
    ]
    mock.method(
        globalThis,
        "setInterval",
        () => ({ unref() {} }) as NodeJS.Timeout,
    )
    try {
        delete process.env.ANTHROPIC_CLI_VERSION
        delete process.env.ANTHROPIC_USER_AGENT
        delete process.env.CLAUDE_CODE_ENTRYPOINT
        const instances = []
        for (const [i, dir] of dirs.entries()) {
            process.env.PI_CODING_AGENT_DIR = dir
            writeFileSync(
                join(dir, "pi-claude-auth.json"),
                JSON.stringify({ cliVersion: `2.2.${i}` }),
            )
            let provider: ProviderConfig | undefined
            let headers:
                | ((
                      event: { headers: Record<string, string | null> },
                      ctx: { model: { provider: string } },
                  ) => void)
                | undefined
            let request: ((event: { payload: unknown }) => unknown) | undefined
            let start:
                | ((
                      event: unknown,
                      ctx: { modelRegistry: unknown },
                  ) => Promise<void>)
                | undefined
            const pi = {
                registerProvider(_id: string, config: ProviderConfig) {
                    provider = config
                },
                on(name: string, handler: unknown) {
                    if (name === "before_provider_request")
                        request = handler as typeof request
                    if (name === "session_start")
                        start = handler as typeof start
                    if (name === "before_provider_headers")
                        headers = handler as typeof headers
                },
            }
            await extension(pi as unknown as ExtensionAPI)
            assert.ok(provider)
            assert.ok(request)
            assert.ok(start)
            await start({}, { modelRegistry: {} }) // Pi 0.85+, no AuthStorage facade
            const set = mock.fn()
            await start({}, { modelRegistry: { authStorage: { set } } })
            assert.equal(set.mock.callCount(), 1)
            assert.deepEqual(set.mock.calls[0].arguments, [
                "anthropic",
                {
                    type: "oauth",
                    access: "fixture",
                    refresh: "fixture",
                    expires: Infinity,
                },
            ])
            assert.ok(headers)
            instances.push({ provider, request, headers })
        }
        // Any request-time read would now fall back or use the changed env.
        for (const dir of dirs) rmSync(dir, { recursive: true })
        process.env.ANTHROPIC_CLI_VERSION = "9.9.9"
        process.env.CLAUDE_CODE_ENTRYPOINT = "changed"
        for (const [i, { provider, request, headers }] of instances.entries()) {
            // Simulate shared ModelRuntime headers replaced by the last factory.
            const outgoing = { headers: { ...instances[1].provider.headers } }
            headers(outgoing, { model: { provider: "anthropic" } })
            assert.equal(
                outgoing.headers["user-agent"],
                provider.headers?.["user-agent"],
            )
            const unrelated = { headers: { "user-agent": "unchanged" } }
            headers(unrelated, { model: { provider: "openai" } })
            assert.equal(unrelated.headers["user-agent"], "unchanged")
            assert.equal(
                provider.headers?.["user-agent"],
                `claude-cli/2.2.${i} (external, sdk-cli)`,
            )
            const payload = {
                model: "claude-opus-4-8",
                messages: [{ role: "user", content: "fixture" }],
                system: [
                    {
                        type: "text",
                        text: "You are Claude Code, Anthropic's official CLI for Claude.",
                    },
                ],
            }
            request({ payload })
            assert.ok(
                payload.system[0].text.startsWith(
                    `x-anthropic-billing-header: cc_version=2.2.${i}.`,
                ),
            )
            assert.ok(payload.system[0].text.includes("cc_entrypoint=sdk-cli;"))
        }
    } finally {
        process.env = original
        mock.restoreAll()
        for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    }
})
