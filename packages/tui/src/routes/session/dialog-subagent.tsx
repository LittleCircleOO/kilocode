import { DialogSelect } from "../../ui/dialog-select"
import { useRoute } from "../../context/route"
import { t } from "@tui/kilocode/i18n" // kilocode_change

export function DialogSubagent(props: { sessionID: string }) {
  const route = useRoute()

  return (
    <DialogSelect
      title={t("Subagent Actions") /* kilocode_change */}
      options={[
        {
          title: t("Open") /* kilocode_change */,
          value: "subagent.view",
          description: t("the subagent's session") /* kilocode_change */,
          onSelect: (dialog) => {
            route.navigate({
              type: "session",
              sessionID: props.sessionID,
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
