import { DialogSelect } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { t, LOCALES, label, detectSystemLocale, currentPreference, setLanguage, type Preference } from "./index"

export function DialogLanguage() {
  const dialog = useDialog()
  const initial = currentPreference()

  const options = [
    {
      title: t("Auto"),
      value: "auto" as Preference,
      // Auto resolves to the detected system locale, which can differ from the
      // currently effective locale when a manual preference is active.
      description: label(detectSystemLocale()),
    },
    ...LOCALES.map((locale) => ({
      title: label(locale),
      value: locale as Preference,
    })),
  ]

  return (
    <DialogSelect
      title={t("Language")}
      options={options}
      current={initial}
      onSelect={(option) => {
        setLanguage(option.value)
        dialog.clear()
      }}
    />
  )
}
