/**
 * Kilo Gateway Commands for TUI
 *
 * Provides /profile and /teams commands that are only visible when connected to Kilo Gateway.
 */

import { createMemo } from "solid-js"
import { useBindings } from "@tui/keymap"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { reconcile } from "solid-js/store"
import type { Organization } from "@kilocode/kilo-gateway"
import { DialogKiloTeamSelect } from "./components/dialog-kilo-team-select.js"
import { DialogKiloProfile } from "./components/dialog-kilo-profile.js"
import { DialogIndexing } from "./components/dialog-indexing.js"
import { DialogProviderUsage } from "./components/dialog-provider-usage.js"
import { indexingEnabled } from "./indexing-feature"
import { refreshBalance } from "./balance-refresh"
import { showAboutDialog } from "./cli/cmd/tui/component/dialog-about.js"
import { t } from "@tui/kilocode/i18n"

// These types are OpenCode-internal and imported at runtime
type UseSDK = any
type SDK = any

/**
 * Register all Kilo Gateway commands
 * Call this from a component inside the TUI app
 *
 * @param useSDK - OpenCode's useSDK hook (passed from TUI context)
 */
export function registerKiloCommands(useSDK: () => UseSDK) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  // Only show Kilo commands when connected to Kilo Gateway
  const isKiloConnected = createMemo(() => {
    return sync.data.provider_next.connected.includes("kilo")
  })
  const indexing = createMemo(() => indexingEnabled(sync.data.config))

  useBindings(() => ({
    commands: [
      // /remote command
      {
        name: "remote.toggle",
        title: t("Toggle remote"),
        desc: t("Enable or disable remote session relay"),
        category: "Kilo",
        slashName: "remote",
        enabled: isKiloConnected(),
        hidden: !isKiloConnected(),
        run: async () => {
          try {
            const current = await sdk.client.remote.status()

            if (current.error || !current.data) {
              dialog.replace(() => <DialogAlert title={t("Error")} message={t("Failed to fetch remote status.")} />)
              return
            }

            if (current.data.enabled) {
              await sdk.client.remote.disable()
              toast.show({ message: t("Remote disabled"), variant: "success" })
            } else {
              const result = await sdk.client.remote.enable()
              if (result.error) {
                const err = result.error as { error?: string }
                const msg = err?.error ?? "Failed to enable remote."
                dialog.replace(() => <DialogAlert title={t("Error")} message={msg} />)
                return
              }
              toast.show({ message: t("Remote enabled"), variant: "success" })
            }

            dialog.clear()
          } catch (error) {
            dialog.replace(() => <DialogAlert title={t("Error")} message={`Failed to toggle remote: ${error}`} />)
          }
        },
      },

      {
        name: "kilo.usage",
        title: t("Plans & usage"),
        desc: t("View provider plans and quota"),
        category: "Kilo",
        slashName: "usage",
        slashAliases: ["plans", "quota"],
        run: () => {
          dialog.replace(() => <DialogProviderUsage />)
        },
      },

      // /profile command
      {
        name: "kilo.profile",
        title: t("Profile"),
        desc: t("View your Kilo Gateway profile"),
        category: "Kilo",
        slashName: "profile",
        slashAliases: ["me", "whoami"],
        enabled: isKiloConnected(),
        hidden: !isKiloConnected(),
        run: async () => {
          try {
            if (sync.data.config.privacy_mode === true || sync.data.globalConfig.privacy_mode === true) {
              const confirmed = await DialogConfirm.show(
                dialog,
                "Privacy Mode Enabled",
                "Privacy mode is on. Revealing your profile will display your email, name, balance, and team on screen.",
              )
              if (confirmed !== true) return
            }

            // Fetch profile and balance using server endpoint
            const response = await sdk.client.kilo.profile()

            if (response.error || !response.data) {
              dialog.replace(() => (
                <DialogAlert
                  title={t("Error")}
                  message={t("Failed to fetch profile. Please ensure you're authenticated with Kilo Gateway.")}
                />
              ))
              return
            }

            const { profile, balance, currentOrgId } = response.data

            // Show profile dialog with clickable usage link
            dialog.replace(() => <DialogKiloProfile profile={profile} balance={balance} currentOrgId={currentOrgId} />)
          } catch (error) {
            dialog.replace(() => <DialogAlert title={t("Error")} message={`Failed to fetch profile: ${error}`} />)
          }
        },
      },

      ...(indexing()
        ? [
            {
              name: "kilo.indexing",
              title: t("Indexing"),
              desc: t("Configure codebase indexing"),
              category: "Kilo",
              slashName: "indexing",
              slashAliases: ["index", "embedding"],
              run: () => {
                dialog.replace(() => <DialogIndexing useSDK={useSDK} />)
              },
            },
          ]
        : []),

      // /privacy command
      {
        name: "kilo.privacy",
        get title() {
          const active = sync.data.config.privacy_mode === true || sync.data.globalConfig.privacy_mode === true
          return active ? t("Disable privacy mode") : t("Enable privacy mode")
        },
        desc: t("Blur PII (balance, email, etc.) and confirm before showing profile"),
        category: "Kilo",
        slashName: "privacy",
        run: async () => {
          const active = sync.data.config.privacy_mode === true || sync.data.globalConfig.privacy_mode === true
          const next = !active
          const updates = [
            sdk.client.config.overlayUpdate({
              scope: "global",
              set: { privacy_mode: next },
            }),
          ]
          if (!next && sync.data.config.privacy_mode === true) {
            updates.push(
              sdk.client.config.overlayUpdate({
                scope: "project",
                unset: [["privacy_mode"]],
              }),
            )
          }
          const responses = await Promise.all(updates)
          const failed = responses.find((r) => r.error)
          if (failed) {
            const status = failed.response?.status ?? "?"
            toast.show({ message: t("Failed to update privacy mode ({{status}})", { status: status }), variant: "error" })
            return
          }
          const [cfg, global] = await Promise.all([
            sdk.client.config.get({}),
            sdk.client.global.config.get({}),
          ])
          if (cfg.data) sync.set("config", reconcile(cfg.data))
          if (global.data) sync.set("globalConfig", reconcile(global.data))
          toast.show({
            message: next ? t("Privacy mode enabled") : t("Privacy mode disabled"),
            variant: "success",
          })
        },
      },

      // /teams command
      {
        name: "kilo.teams",
        title: t("Teams"),
        desc: t("Switch between Kilo Gateway teams"),
        category: "Kilo",
        slashName: "teams",
        slashAliases: ["team", "org", "orgs"],
        enabled: isKiloConnected(),
        hidden: !isKiloConnected(),
        run: async () => {
          try {
            // Fetch profile to get organizations
            const response = await sdk.client.kilo.profile()

            if (response.error || !response.data) {
              dialog.replace(() => (
                <DialogAlert
                  title={t("Error")}
                  message={t("Failed to fetch teams. Please ensure you're authenticated with Kilo Gateway.")}
                />
              ))
              return
            }

            const { profile, currentOrgId } = response.data

            if (!profile.organizations || profile.organizations.length === 0) {
              dialog.replace(() => (
                <DialogAlert
                  title={t("No Teams Available")}
                  message="You're not a member of any teams.\nVisit https://app.kilo.ai to create or join a team."
                />
              ))
              return
            }

            // Show team selection dialog
            dialog.replace(() => (
              <DialogKiloTeamSelect
                organizations={profile.organizations!}
                currentOrgId={currentOrgId}
                hasPersonalAccount={profile.hasPersonalAccount !== false}
                onSelect={async (orgId) => {
                  try {
                    // Switch to team immediately using server endpoint
                    const result = await sdk.client.kilo.organization.set({
                      organizationId: orgId,
                    })
                    if (result.error) {
                      toast.show({
                        message: t("Failed to switch team"),
                        variant: "error",
                      })
                      dialog.clear()
                      return
                    }

                    // Refresh provider state to reload models with new organization context
                    await sdk.client.instance.dispose()
                    await sync.bootstrap()

                    // Update the sidebar balance immediately for the newly selected account
                    refreshBalance()

                    // Show success toast
                    const teamName = orgId
                      ? profile.organizations!.find((o: Organization) => o.id === orgId)?.name
                      : "Personal"

                    toast.show({
                      message: t("Switched to: {{teamName}}", { teamName: teamName }),
                      variant: "success",
                    })

                    // Close dialog
                    dialog.clear()
                  } catch (error) {
                    if (error instanceof DOMException && error.name === "AbortError") return
                    toast.show({
                      message: t("Failed to switch team"),
                      variant: "error",
                    })
                    dialog.clear()
                  }
                }}
              />
            ))
          } catch (error) {
            dialog.replace(() => <DialogAlert title={t("Error")} message={`Failed to fetch teams: ${error}`} />)
          }
        },
      },

      // /about command
      {
        name: "kilo.about",
        title: t("About"),
        desc: t("Show version, environment, and diagnostic info"),
        category: "Kilo",
        slashName: "about",
        run: () => {
          showAboutDialog(dialog)
        },
      },
    ].map((command) => ({
      namespace: "palette",
      ...command,
    })),
  }))
}
