import { t } from "@tui/kilocode/i18n"

export const FreeModelDisclosure = {
  label: t("May train"),
  panel: "Data may be used for training",
  byok: "BYOK",
  collectsData(model: { mayTrainOnYourPrompts?: boolean }): boolean {
    return model.mayTrainOnYourPrompts === true
  },
  hasByok(model: { hasUserByokAvailable?: boolean }): boolean {
    return model.hasUserByokAvailable === true
  },
} as const
