import type { TuiPlugin } from "@kilocode/plugin/tui"
import type { InternalTuiPlugin } from "@/plugin/tui/internal"
import { SessionSwitcherDialog } from "./dialog"
import { t } from "@tui/kilocode/i18n"

const id = "internal:session-switcher"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    priority: 1000,
    commands: [
      {
        name: "session.list",
        title: t("Switch session"),
        category: "Session",
        namespace: "palette",
        suggested: () => api.state.session.count() > 0,
        slashName: "sessions",
        slashAliases: ["resume", "continue"],
        run() {
          api.ui.dialog.replace(() => <SessionSwitcherDialog />)
        },
      },
    ],
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
