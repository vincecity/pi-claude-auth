import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, mock, test } from "node:test"
import { CC_VERSION, getCliVersion } from "./signing.ts"

let home: string
const previous = { ...process.env }
beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "claude-auth-config-"))
    process.env.HOME = home
    process.env.PI_CODING_AGENT_DIR = join(home, "active-agent")
    delete process.env.ANTHROPIC_CLI_VERSION
})
afterEach(() => {
    process.env = { ...previous }
    mock.restoreAll()
    rmSync(home, { recursive: true, force: true })
})

function config(dir: string, contents: string) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "pi-claude-auth.json"), contents)
}

test("missing config uses 2.1.258 without a warning", () => {
    const warn = mock.method(console, "warn", () => {})
    assert.equal(getCliVersion(), "2.1.258")
    assert.equal(warn.mock.callCount(), 0)
})

test("active Pi home wins over standard home and project files", () => {
    config(join(home, ".pi", "agent"), '{"cliVersion":"1.0.0"}')
    config(join(home, ".pi"), '{"cliVersion":"1.1.0"}')
    config(process.env.PI_CODING_AGENT_DIR!, '{"cliVersion":"2.2.0"}')
    assert.equal(getCliVersion(), "2.2.0")
})

test("valid environment override wins even over malformed JSON", () => {
    config(process.env.PI_CODING_AGENT_DIR!, "{invalid")
    process.env.ANTHROPIC_CLI_VERSION = " 3.1.258 "
    const warn = mock.method(console, "warn", () => {})
    assert.equal(getCliVersion(), "3.1.258")
    assert.equal(warn.mock.callCount(), 0)
})

test("invalid environment override falls through to local config", () => {
    config(process.env.PI_CODING_AGENT_DIR!, '{"cliVersion":"2.2.0"}')
    const warn = mock.method(console, "warn", () => {})
    for (const value of ["", "2.1", "v2.1.258", "2.1.258\r\ninjected: yes"]) {
        process.env.ANTHROPIC_CLI_VERSION = value
        assert.equal(getCliVersion(), "2.2.0")
    }
    assert.equal(warn.mock.callCount(), 4)
})

for (const value of [
    "{invalid",
    "null",
    "[]",
    '"2.1.258"',
    '{"cliVersion":258}',
    '{"cliVersion":null}',
    '{"cliVersion":""}',
    '{"cliVersion":"2.1"}',
    '{"cliVersion":"02.1.258"}',
    '{"cliVersion":"2.1.258-beta"}',
]) {
    test(`invalid config falls back: ${value}`, () => {
        config(process.env.PI_CODING_AGENT_DIR!, value)
        const warn = mock.method(console, "warn", () => {})
        assert.equal(getCliVersion(), CC_VERSION)
        assert.equal(warn.mock.callCount(), 1)
    })
}

test("empty object and unreadable file use fallback", () => {
    const dir = process.env.PI_CODING_AGENT_DIR!
    config(dir, "{}")
    assert.equal(getCliVersion(), CC_VERSION)
    rmSync(join(dir, "pi-claude-auth.json"))
    mkdirSync(join(dir, "pi-claude-auth.json"))
    const warn = mock.method(console, "warn", () => {})
    assert.equal(getCliVersion(), CC_VERSION)
    assert.equal(warn.mock.callCount(), 1)
})

test("resolution is not cached across homes or reloads", () => {
    const a = join(home, "a")
    const b = join(home, "b")
    config(a, '{"cliVersion":"2.2.1"}')
    config(b, '{"cliVersion":"2.2.2"}')
    assert.equal(getCliVersion(a), "2.2.1")
    assert.equal(getCliVersion(b), "2.2.2")
    config(a, '{"cliVersion":"2.2.3"}')
    assert.equal(getCliVersion(a), "2.2.3")
})
