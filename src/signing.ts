import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getAgentDir } from "@earendil-works/pi-coding-agent"

const BILLING_SALT = "59cf53e54c78"

// Claude Code CLI version used for the billing header AND the overridden
// user-agent. The billing header's cc_version must match the user-agent
// version for Anthropic's subscription-billing validation to route the request
// to the Claude Pro/Max plan instead of pay-as-you-go / extra usage.
// Overridable via ANTHROPIC_CLI_VERSION or pi-claude-auth.json.
export const CC_VERSION = "2.1.280"

// Billing entrypoint, mirrored in the user-agent's `(external, <entrypoint>)`
// suffix. Overridable via CLAUDE_CODE_ENTRYPOINT.
export const CC_ENTRYPOINT = "sdk-cli"

/** Read once at extension load. Never cache across agent homes or sessions. */
export function getCliVersion(agentDir = getAgentDir()): string {
    const override = process.env.ANTHROPIC_CLI_VERSION
    if (override !== undefined) {
        if (isCliVersion(override)) return override.trim()
        console.warn(
            "pi-claude-auth: Ignoring invalid ANTHROPIC_CLI_VERSION; expected major.minor.patch.",
        )
    }

    const path = join(agentDir, "pi-claude-auth.json")
    try {
        const config: unknown = JSON.parse(readFileSync(path, "utf8"))
        if (!config || typeof config !== "object" || Array.isArray(config)) {
            throw new Error("expected a JSON object")
        }
        const version = (config as { cliVersion?: unknown }).cliVersion
        if (version === undefined) return CC_VERSION
        if (!isCliVersion(version))
            throw new Error("expected cliVersion: major.minor.patch")
        return version.trim()
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            // Do not log file contents, which may contain unrelated private data.
            console.warn(
                `pi-claude-auth: Cannot use ${path}; using CLI version ${CC_VERSION}.`,
            )
        }
        return CC_VERSION
    }
}

function isCliVersion(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length <= 32 &&
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.trim())
    )
}

/** Resolve the billing entrypoint (env override wins). */
export function getEntrypoint(): string {
    return process.env.CLAUDE_CODE_ENTRYPOINT ?? CC_ENTRYPOINT
}

/**
 * Build the Claude Code user-agent string. pi sends a bare
 * `claude-cli/<version>`; Anthropic's plan-billing validation expects the full
 * `claude-cli/<version> (external, <entrypoint>)` form, so we override it.
 */
export function buildUserAgent(
    version = getCliVersion(),
    entrypoint = getEntrypoint(),
): string {
    return (
        process.env.ANTHROPIC_USER_AGENT ??
        `claude-cli/${version} (external, ${entrypoint})`
    )
}

interface Message {
    role?: string
    content?: string | Array<{ type?: string; text?: string }>
}

/**
 * Extract text from the first user message's first text block.
 * Mirrors Claude Code's billing-header input selection: find the first message
 * with role "user", then return the text of its first text content block.
 */
export function extractFirstUserMessageText(messages: Message[]): string {
    const userMsg = messages.find((m) => m.role === "user")
    if (!userMsg) return ""
    const content = userMsg.content
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        const textBlock = content.find((b) => b.type === "text")
        if (textBlock && textBlock.type === "text" && textBlock.text) {
            return textBlock.text
        }
    }
    return ""
}

/** Compute cch: first 5 hex characters of SHA-256(messageText). */
export function computeCch(messageText: string): string {
    return createHash("sha256").update(messageText).digest("hex").slice(0, 5)
}

/**
 * Compute the 3-char version suffix.
 * Samples characters at indices 4, 7, 20 from the message text (padding with
 * "0" when the message is shorter), then hashes with the billing salt and
 * version string.
 */
export function computeVersionSuffix(
    messageText: string,
    version: string,
): string {
    const sampled = [4, 7, 20]
        .map((i) => (i < messageText.length ? messageText[i] : "0"))
        .join("")
    const input = `${BILLING_SALT}${sampled}${version}`
    return createHash("sha256").update(input).digest("hex").slice(0, 3)
}

/**
 * Build the complete billing header string for insertion into system[0].
 * Format: x-anthropic-billing-header: cc_version=V.S; cc_entrypoint=E; cch=H;
 */
export function buildBillingHeaderValue(
    messages: Message[],
    version: string,
    entrypoint: string,
): string {
    const text = extractFirstUserMessageText(messages)
    const suffix = computeVersionSuffix(text, version)
    const cch = computeCch(text)
    return (
        `x-anthropic-billing-header: ` +
        `cc_version=${version}.${suffix}; ` +
        `cc_entrypoint=${entrypoint}; ` +
        `cch=${cch};`
    )
}
