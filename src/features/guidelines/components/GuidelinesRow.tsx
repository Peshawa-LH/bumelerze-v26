import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsRow } from "@/features/account/components/SettingsRow";
import { GuidelinesSheet } from "./GuidelinesSheet";

/** Settings > Help: opens the community guidelines to read. */
export function GuidelinesRow() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingsRow
        icon="document-text-outline"
        label={t("guidelines.settingsLabel")}
        value={t("guidelines.settingsValue")}
        valueLayout="stacked"
        onPress={() => setOpen(true)}
        testID="settings-row-guidelines"
      />
      {open ? (
        <GuidelinesSheet
          mode="read"
          onClose={() => setOpen(false)}
          testID="guidelines-read"
        />
      ) : null}
    </>
  );
}
