import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Share, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useAccount } from "@/features/account/use-account";
import { isolateNumeric } from "@/features/events/format";
import { useTheme } from "@/theme";
import { buildJoinLink } from "../constants";
import { homeErrorText } from "../error-text";
import { useFamily, useHome, useHomeActions } from "../queries";
import type { HomeMember } from "../types";
import { AccountGate } from "./AccountGate";
import { DeleteHomeButton } from "./DeleteHomeButton";
import { JoinQr } from "./JoinQr";
import { Body, Card, ErrorText, Heading, Meta, ScreenFrame } from "./ui";

export function FamilyScreen({ tagId }: { tagId: string | undefined }) {
  const { t } = useTranslation();
  return (
    <ScreenFrame title={t("building.family.title")}>
      <AccountGate>
        <FamilyBody tagId={tagId} />
      </AccountGate>
    </ScreenFrame>
  );
}

function FamilyBody({ tagId }: { tagId: string | undefined }) {
  const { t } = useTranslation();
  const home = useHome(tagId);
  if (home.isLoading) {
    return <Body tone="secondary">{t("building.loading")}</Body>;
  }
  if (!home.data?.tag || !home.data.role || !tagId) {
    return <Body tone="secondary">{t("building.report.notAvailable")}</Body>;
  }
  return (
    <Family
      tagId={tagId}
      code={home.data.tag.code}
      isOwner={home.data.role === "owner"}
    />
  );
}

/** Family of one home. Owners see the code and secret key, pending requests
 * and the member list; members see the member list and can leave. */
export function Family({
  tagId,
  code,
  isOwner,
}: {
  tagId: string;
  code: string;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const account = useAccount();
  const family = useFamily(tagId, isOwner);
  const actions = useHomeActions();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const joinKey = newKey ?? family.data?.joinKey ?? null;
  const members = family.data?.members ?? [];
  const names = family.data?.names ?? {};
  const approved = members.filter((member) => member.status === "approved");
  const pending = members.filter((member) => member.status === "pending");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await action();
    } catch (caught) {
      setError(homeErrorText(t, caught));
    } finally {
      setBusy(false);
    }
  }

  // The QR and the shared message carry the same link: code and key only.
  const joinLink = joinKey ? buildJoinLink(code, joinKey) : null;
  const shareText = joinLink ? t("building.family.shareMessage", { link: joinLink }) : "";

  async function share() {
    await run(async () => {
      try {
        await Share.share({ message: shareText });
      } catch {
        // No system share sheet (some browsers): copy instead.
        await Clipboard.setStringAsync(shareText);
        setNote(t("building.family.copied"));
      }
    });
  }

  async function copy() {
    await run(async () => {
      await Clipboard.setStringAsync(shareText);
      setNote(t("building.family.copied"));
    });
  }

  function memberName(member: HomeMember): string {
    const base = names[member.userId] ?? t("building.family.unnamed");
    return member.userId === account.userId
      ? t("building.family.you", { name: base })
      : base;
  }

  return (
    <View style={{ gap: spacing[4] }}>
      {isOwner ? (
        <Card testID="family-share">
          <Heading level={3}>{t("building.family.shareTitle")}</Heading>
          <Meta>{t("building.family.shareHint")}</Meta>
          {joinLink ? <JoinQr value={joinLink} /> : null}
          <Meta>{t("building.report.codeLabel")}</Meta>
          <Heading level={2}>{isolateNumeric(code)}</Heading>
          <Meta>{t("building.family.keyLabel")}</Meta>
          <Heading level={2}>{joinKey ? isolateNumeric(joinKey) : "-"}</Heading>
          <AccountButton
            tone="primary"
            label={t("building.family.share")}
            onPress={() => void share()}
            disabled={busy || !joinKey}
            testID="family-share-button"
          />
          <AccountButton
            label={t("building.family.copy")}
            onPress={() => void copy()}
            disabled={busy || !joinKey}
            testID="family-copy"
          />
          <AccountButton
            label={t("building.family.newKey")}
            onPress={() =>
              void run(async () => {
                setNewKey(await actions.rotateKey(tagId));
                setNote(t("building.family.newKeyDone"));
              })
            }
            disabled={busy}
            testID="family-new-key"
          />
          <Meta>{t("building.family.newKeyHint")}</Meta>
        </Card>
      ) : null}

      {isOwner && pending.length > 0 ? (
        <Card testID="family-pending">
          <Heading level={3}>{t("building.family.pendingTitle")}</Heading>
          {pending.map((member) => (
            <View key={member.userId} style={{ gap: spacing[2] }}>
              <Body>{names[member.userId] ?? t("building.family.unnamed")}</Body>
              <View style={styles.row}>
                <View style={styles.cell}>
                  <AccountButton
                    tone="primary"
                    label={t("building.family.approve")}
                    onPress={() =>
                      void run(() => actions.decide(tagId, member.userId, true))
                    }
                    disabled={busy}
                    testID={`family-approve-${member.userId}`}
                  />
                </View>
                <View style={styles.cell}>
                  <AccountButton
                    label={t("building.family.decline")}
                    onPress={() =>
                      void run(() => actions.decide(tagId, member.userId, false))
                    }
                    disabled={busy}
                    testID={`family-decline-${member.userId}`}
                  />
                </View>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      <Card testID="family-members">
        <Heading level={3}>{t("building.family.membersTitle")}</Heading>
        {family.isLoading ? <Meta>{t("building.loading")}</Meta> : null}
        {approved.map((member) => (
          <View key={member.userId} style={styles.memberRow}>
            <Body>{memberName(member)}</Body>
            {member.role === "owner" ? <Meta>{t("building.family.owner")}</Meta> : null}
          </View>
        ))}
      </Card>

      {note ? <Meta>{note}</Meta> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isOwner ? (
        <DeleteHomeButton tagId={tagId} />
      ) : confirmingLeave ? (
        <Card testID="family-leave-confirm">
          <Body>{t("building.family.leaveWarning")}</Body>
          <AccountButton
            tone="destructiveSolid"
            label={t("building.family.leaveConfirm")}
            onPress={() =>
              void run(async () => {
                await actions.leave(tagId);
                router.replace("/my-data");
              })
            }
            disabled={busy}
            testID="family-leave-yes"
          />
          <AccountButton
            label={t("building.family.cancel")}
            onPress={() => setConfirmingLeave(false)}
            disabled={busy}
            testID="family-leave-no"
          />
        </Card>
      ) : (
        <AccountButton
          tone="destructive"
          label={t("building.family.leave")}
          onPress={() => setConfirmingLeave(true)}
          testID="family-leave"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12 },
  cell: { flex: 1 },
  memberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
