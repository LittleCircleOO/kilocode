import { Schema } from "effect"
import { t } from "@tui/kilocode/i18n"

export namespace KiloTitleIcon {
  export const Value = Schema.Literals(["none", "unicode", "emojis"]).annotate({
    description: t("Status icon style shown in terminal titles"),
  })
  export type Value = Schema.Schema.Type<typeof Value>
  export const Default = "none" satisfies Value
}
