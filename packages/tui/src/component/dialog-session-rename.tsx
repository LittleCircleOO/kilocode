import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"
import { t } from "@tui/kilocode/i18n" // kilocode_change

interface DialogSessionRenameProps {
  session: string
  title?: string // kilocode_change
  onConfirm?: () => void // kilocode_change
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const session = createMemo(() => sync.session.get(props.session))

  return (
    <DialogPrompt
      title={t("Rename Session") /* kilocode_change */}
      value={session()?.title ?? props.title} // kilocode_change
      onConfirm={(value) => {
        void sdk.client.session
          .update({
            sessionID: props.session,
            title: value,
          })
          .then(() => props.onConfirm?.()) // kilocode_change
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
