import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { t } from "@tui/kilocode/i18n" // kilocode_change

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.displayName ?? item.name, // kilocode_change
        description:
          [item.deprecated && "deprecated", item.native && "native"].filter(Boolean).join(", ") || item.description,
      }
    }),
  )

  return (
    <DialogSelect
      title={t("Select agent") /* kilocode_change */}
      current={local.agent.current()?.name ?? ""} // kilocode_change
      options={options()}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
