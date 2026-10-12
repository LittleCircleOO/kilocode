import type { KiloClient } from "@kilocode/sdk/v2"
import { MEMORY_USAGE, parseMemoryCommand, type ParsedMemoryCommand } from "@kilocode/kilo-memory/commands"
import { errorMessage } from "@/util/error"
import { t } from "@tui/kilocode/i18n"

export { MEMORY_USAGE }
export type MemoryCommand = ParsedMemoryCommand

type Toast = {
  show(input: { message: string; variant: "error" | "info" | "success" }): void
}

type Result<T> = {
  data?: T
  error?: unknown
}

function read<T>(result: Result<T>) {
  if (result.error) throw new Error(errorMessage(result.error))
  if (result.data === undefined) throw new Error("Memory command returned no data")
  return result.data
}

/** Shared by the TUI memory command, dialog, and sidebar: routes an SDK call to the requested
 * workspace or directory, falling back to the client's default scope when neither is set. */
export function route(input: { workspace?: string; directory?: string }) {
  return {
    ...(input.workspace ? { workspace: input.workspace } : input.directory ? { directory: input.directory } : {}),
  }
}

function tokens(count: number) {
  return `${count.toLocaleString()} memory ${count === 1 ? "token" : "tokens"}`
}

function changeCount(count: number) {
  return `${count} ${count === 1 ? "change" : "changes"}`
}

function auto(input: boolean) {
  return `Memory auto-save ${input ? "on" : "off"}`
}

export function parseMemoryInput(input: string): MemoryCommand | undefined {
  return parseMemoryCommand(input)
}

export async function runMemoryCommand(input: {
  text: string
  client: KiloClient
  workspace?: string
  directory?: string
  sessionID?: string
  toast: Toast
  inspect?(root: string): void | Promise<void>
  show(): void
  status(): void
  usage(message?: string): void
}) {
  const parsed = parseMemoryInput(input.text)
  if (!parsed) return false

  try {
    if (parsed.kind === "help") {
      input.usage()
      return true
    }
    if (parsed.kind === "show") {
      input.show()
      return true
    }
    if (parsed.kind === "usage") {
      input.usage(parsed.reason)
      return true
    }
    const name = "Memory"
    if (parsed.operation === "enable") {
      read(await input.client.memory.enable(route(input)))
      input.toast.show({
        variant: "success",
        message: t("{{name}} enabled", { name: name }),
      })
      return true
    }
    if (parsed.operation === "status") {
      input.status()
      return true
    }
    if (parsed.operation === "inspect") {
      const status = read(await input.client.memory.status(route(input)))
      if (!status.state.enabled) throw new Error("Memory is disabled. Run /memory on first.")
      if (!input.inspect) throw new Error("Memory folder inspection is unavailable")
      input.toast.show({ variant: "info", message: t("Memory folder: {{root}}", { root: status.root }) })
      await input.inspect(status.root)
      return true
    }
    if (parsed.operation === "auto") {
      const result = read(
        await input.client.memory.configure({
          ...route(input),
          autoConsolidate: parsed.mode === "on",
        }),
      )
      input.toast.show({ variant: "info", message: auto(result.state.autoConsolidate) })
      return true
    }
    if (parsed.operation === "disable") {
      read(await input.client.memory.disable(route(input)))
      input.toast.show({ variant: "info", message: t("{{name}} disabled", { name: name }) })
      return true
    }
    if (parsed.operation === "rebuild") {
      const result = read(await input.client.memory.rebuild(route(input)))
      input.toast.show({ variant: "success", message: t("{{name}} rebuilt ({{p1}})", { name: name, p1: tokens(result.index.tokens) }) })
      return true
    }
    if (parsed.operation === "purge") {
      read(await input.client.memory.purge({ ...route(input), confirm: true }))
      input.toast.show({ variant: "success", message: t("{{name}} purged", { name: name }) })
      return true
    }
    // Wording mirrors the server memory event messages so chat-intent and command saves read the same.
    if (parsed.operation === "remember") {
      const result = read(
        await input.client.memory.remember({
          ...route(input),
          ...(input.sessionID ? { sessionID: input.sessionID } : {}),
          text: parsed.text,
        }),
      )
      input.toast.show({ variant: "success", message: t("Memory saved · {{p0}}", { p0: changeCount(result.operationCount) }) })
      return true
    }
    if (parsed.operation === "correct") {
      const result = read(
        await input.client.memory.correct({
          ...route(input),
          ...(input.sessionID ? { sessionID: input.sessionID } : {}),
          text: parsed.text,
        }),
      )
      input.toast.show({ variant: "success", message: t("Correction saved · {{p0}}", { p0: changeCount(result.operationCount) }) })
      return true
    }

    if (parsed.operation === "forget") {
      const result = read(
        await input.client.memory.forget({
          ...route(input),
          ...(input.sessionID ? { sessionID: input.sessionID } : {}),
          query: parsed.query,
        }),
      )
      input.toast.show({ variant: "success", message: t("Memory updated · {{p0}} removed", { p0: result.removed.toLocaleString() }) })
    }
    return true
  } catch (error) {
    input.toast.show({ variant: "error", message: t("Memory command failed: {{p0}}", { p0: errorMessage(error) }) })
    return true
  }
}
