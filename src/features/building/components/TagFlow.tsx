import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { DEFAULT_PLACE_ID, gazetteerPlaceById, type Place } from "@/features/geo";
import { PlaceSearch } from "@/features/geo/components/PlaceSearch";
import { usePrefsStore } from "@/features/onboarding";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { LABEL_MAX, UNIT_LABEL_MAX } from "../constants";
import { homeErrorText } from "../error-text";
import {
  canAdvance,
  editStep,
  goBack,
  goNext,
  initialFlowState,
  isOptionalQuestion,
  photoList,
  progress,
  setAnswer,
  setPhoto,
  type FlowLocation,
  type FlowMode,
  type FlowState,
  type StepRef,
} from "../flow-state";
import {
  canConfirmPin,
  pinLocation,
  pinStart,
  type PinPoint,
  type PinStart,
} from "../pin";
import { PHOTO_SLOTS, pickHomePhoto, type PhotoSlot, type PhotoSource } from "../photos";
import {
  QUESTIONS,
  visibleQuestions,
  type Answers,
  type QuestionId,
} from "../questionnaire";
import { useHomeActions } from "../queries";
import { createHomeFromDraft } from "../service";
import type { HomeKind, HomeTag } from "../types";
import { useGpsFix } from "../use-gps-fix";
import { PIN_MAP_AVAILABLE, PinMap } from "./PinMap";
import {
  Body,
  ErrorText,
  Heading,
  Meta,
  OptionButton,
  ProgressBar,
  ScreenFrame,
  TextField,
} from "./ui";

interface TagFlowProps {
  /** Set to redo the questions of an existing home. */
  retake?: { tag: HomeTag; answers: Answers };
}

/**
 * "Tag my building": one family's home, one question per screen. New homes
 * go kind, location, questions, photos, review; a retake is questions and
 * review only. Nothing is sent until the last button.
 */
export function TagFlow({ retake }: TagFlowProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const actions = useHomeActions();
  const mode: FlowMode = retake ? "retake" : "new";
  const [state, setState] = useState<FlowState>(() =>
    initialFlowState(mode, retake?.answers),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A failed save after the tag was created resumes with the same tag.
  const createdTagId = useRef<string | null>(null);

  const { current, total } = progress(state);
  const last = state.step === "review";

  function back() {
    const previous = goBack(state);
    if (previous) {
      setState(previous);
    } else {
      router.back();
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let tagId: string;
      if (retake) {
        await actions.retake(retake.tag, state.answers);
        tagId = retake.tag.tagId;
      } else if (state.kind && state.location) {
        const outcome = await createHomeFromDraft(
          {
            kind: state.kind,
            label: state.label,
            unitLabel: state.unitLabel,
            lat: state.location.lat,
            lon: state.location.lon,
            locationQuality: state.location.quality,
            answers: state.answers,
            photos: photoList(state),
          },
          {
            existingTagId: createdTagId.current,
            onTagCreated: (id) => {
              createdTagId.current = id;
            },
          },
        );
        tagId = outcome.tagId;
        await actions.refresh();
      } else {
        return;
      }
      router.replace({ pathname: "/home/[tagId]/report", params: { tagId } });
    } catch (caught) {
      setError(homeErrorText(t, caught));
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={styles.footerRow}>
        <View style={styles.footerCell}>
          <AccountButton
            label={t("building.flow.back")}
            onPress={back}
            disabled={busy}
            testID="flow-back"
          />
        </View>
        <View style={styles.footerCell}>
          {last ? (
            <AccountButton
              tone="primary"
              label={
                busy
                  ? t("building.flow.saving")
                  : retake
                    ? t("building.flow.save")
                    : t("building.flow.create")
              }
              onPress={() => void submit()}
              disabled={busy}
              testID="flow-submit"
            />
          ) : (
            <AccountButton
              tone="primary"
              label={
                (state.step === "photos" && photoList(state).length === 0) ||
                (state.step === "question" &&
                  isOptionalQuestion(state.questionId) &&
                  state.answers[state.questionId] === undefined)
                  ? t("building.flow.skip")
                  : t("building.flow.next")
              }
              onPress={() => setState(goNext(state))}
              disabled={!canAdvance(state)}
              testID="flow-next"
            />
          )}
        </View>
      </View>
    </>
  );

  return (
    <ScreenFrame
      title={retake ? t("building.report.retake") : t("building.title")}
      footer={footer}
    >
      <ProgressBar
        value={current}
        max={total}
        label={t("building.flow.progress", {
          current: localizeDigits(String(current), i18n.language),
          total: localizeDigits(String(total), i18n.language),
        })}
      />
      {state.step === "kind" ? (
        <KindStep state={state} onChange={setState} />
      ) : state.step === "location" ? (
        <LocationStep state={state} onChange={setState} />
      ) : state.step === "question" ? (
        <QuestionStep state={state} onChange={setState} />
      ) : state.step === "photos" ? (
        <PhotosStep state={state} onChange={setState} />
      ) : (
        <ReviewStep state={state} onChange={setState} />
      )}
    </ScreenFrame>
  );
}

interface StepProps {
  state: FlowState;
  onChange: (state: FlowState) => void;
}

function KindStep({ state, onChange }: StepProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const kinds: HomeKind[] = ["house", "apartment"];
  return (
    <View style={{ gap: spacing[3] }}>
      <Heading>{t("building.flow.kind.title")}</Heading>
      {kinds.map((kind) => (
        <OptionButton
          key={kind}
          label={t(`building.flow.kind.${kind}`)}
          selected={state.kind === kind}
          onPress={() => onChange({ ...state, kind })}
          testID={`kind-${kind}`}
        />
      ))}
      <TextField
        label={t("building.flow.kind.labelLabel")}
        placeholder={t("building.flow.kind.labelPlaceholder")}
        value={state.label}
        maxLength={LABEL_MAX}
        onChangeText={(label) => onChange({ ...state, label })}
        testID="flow-label"
      />
      {state.kind === "apartment" ? (
        <TextField
          label={t("building.flow.kind.unitLabel")}
          placeholder={t("building.flow.kind.unitPlaceholder")}
          value={state.unitLabel}
          maxLength={UNIT_LABEL_MAX}
          onChangeText={(unitLabel) => onChange({ ...state, unitLabel })}
          testID="flow-unit"
        />
      ) : null}
    </View>
  );
}

function LocationStep({ state, onChange }: StepProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const gps = useGpsFix();
  const referencePlace = usePrefsStore((prefs) => prefs.referencePlace);
  const [pinning, setPinning] = useState<{ start: PinStart; point: PinPoint } | null>(
    null,
  );
  const hasGps = state.location?.quality === "gps";
  const hasPin = state.location?.quality === "pin";
  const fallback = useMemo(() => {
    const town = gazetteerPlaceById(DEFAULT_PLACE_ID);
    return { lat: town?.lat ?? 36.19, lon: town?.lon ?? 44.01 };
  }, []);

  async function locateMe() {
    const fix = await gps.request();
    if (fix) {
      onChange({ ...state, location: { lat: fix.lat, lon: fix.lon, quality: "gps" } });
    }
  }

  function choosePlace(place: Place) {
    const location: FlowLocation = {
      lat: place.lat,
      lon: place.lon,
      quality: "town",
      placeId: place.id,
    };
    onChange({ ...state, location });
  }

  function startPinning() {
    const start = pinStart(state.location, referencePlace, fallback);
    setPinning({ start, point: { lat: start.lat, lon: start.lon } });
  }

  if (pinning) {
    return (
      <View style={{ gap: spacing[3] }}>
        <Heading>{t("building.flow.location.pinTitle")}</Heading>
        <Meta>{t("building.flow.location.pinHint")}</Meta>
        <PinMap
          start={pinning.start}
          onPoint={(point) => setPinning({ ...pinning, point })}
          accessibilityLabel={t("building.flow.location.pinMapLabel")}
        />
        <View style={styles.footerRow}>
          <View style={styles.footerCell}>
            <AccountButton
              label={t("building.flow.location.pinCancel")}
              onPress={() => setPinning(null)}
              testID="location-pin-cancel"
            />
          </View>
          <View style={styles.footerCell}>
            <AccountButton
              tone="primary"
              label={t("building.flow.location.pinConfirm")}
              onPress={() => {
                onChange({ ...state, location: pinLocation(pinning.point) });
                setPinning(null);
              }}
              disabled={!canConfirmPin(pinning.start, pinning.point)}
              testID="location-pin-confirm"
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <Heading>{t("building.flow.location.title")}</Heading>
      <Meta>{t("building.flow.location.private")}</Meta>
      <AccountButton
        tone={hasGps ? "secondary" : "primary"}
        label={
          gps.status === "busy"
            ? t("building.flow.location.gpsBusy")
            : t("building.flow.location.gps")
        }
        onPress={() => void locateMe()}
        disabled={gps.status === "busy"}
        testID="location-gps"
      />
      {hasGps ? (
        <Body tone="secondary">{t("building.flow.location.gpsDone")}</Body>
      ) : null}
      {gps.status === "failed" ? (
        <ErrorText>{t("building.flow.location.gpsFailed")}</ErrorText>
      ) : null}
      {PIN_MAP_AVAILABLE ? (
        <>
          <AccountButton
            tone={hasPin ? "secondary" : "primary"}
            label={t("building.flow.location.pin")}
            onPress={startPinning}
            testID="location-pin"
          />
          {hasPin ? (
            <Body tone="secondary">{t("building.flow.location.pinDone")}</Body>
          ) : null}
        </>
      ) : null}
      <Body tone="secondary">{t("building.flow.location.or")}</Body>
      <PlaceSearch
        selectedPlaceId={
          state.location?.quality === "town" ? (state.location.placeId ?? null) : null
        }
        onSelect={choosePlace}
        testID="location-place-search"
      />
      {state.location?.quality === "town" ? (
        <Meta>{t("building.flow.location.townNote")}</Meta>
      ) : null}
    </View>
  );
}

function QuestionStep({ state, onChange }: StepProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const question = QUESTIONS.find((candidate) => candidate.id === state.questionId);
  if (!question) {
    return null;
  }
  return (
    <View style={{ gap: spacing[3] }} accessibilityRole="radiogroup">
      <Heading>{t(`building.q.${question.id}.title`)}</Heading>
      {question.options.map((option) => (
        <OptionButton
          key={option}
          label={t(`building.q.${question.id}.options.${option}`)}
          selected={state.answers[question.id] === option}
          onPress={() => onChange(setAnswer(state, question.id, option))}
          testID={`option-${question.id}-${option}`}
        />
      ))}
    </View>
  );
}

function PhotosStep({ state, onChange }: StepProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [busySlot, setBusySlot] = useState<PhotoSlot | null>(null);

  async function pick(slot: PhotoSlot, source: PhotoSource) {
    setBusySlot(slot);
    try {
      const uri = await pickHomePhoto(source);
      if (uri) {
        onChange(setPhoto(state, slot, uri));
      }
    } catch {
      // A failed pick leaves the slot as it was; photos are optional.
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <Heading>{t("building.flow.photos.title")}</Heading>
      <Meta>{t("building.flow.photos.intro")}</Meta>
      {PHOTO_SLOTS.map((slot) => {
        const uri = state.photos[slot];
        return (
          <View
            key={slot}
            style={[
              styles.photoCard,
              {
                borderColor: colors.border.default,
                padding: spacing[3],
                gap: spacing[2],
              },
            ]}
          >
            <Body>{t(`building.flow.photos.${slot}`)}</Body>
            {uri ? (
              <Image
                source={{ uri }}
                contentFit="cover"
                accessibilityLabel={t(`building.flow.photos.${slot}`)}
                style={styles.thumb}
              />
            ) : null}
            <View style={styles.footerRow}>
              <View style={styles.footerCell}>
                <AccountButton
                  label={t("building.flow.photos.take")}
                  onPress={() => void pick(slot, "camera")}
                  disabled={busySlot !== null}
                  testID={`photo-${slot}-camera`}
                />
              </View>
              <View style={styles.footerCell}>
                <AccountButton
                  label={t("building.flow.photos.choose")}
                  onPress={() => void pick(slot, "library")}
                  disabled={busySlot !== null}
                  testID={`photo-${slot}-library`}
                />
              </View>
            </View>
            {uri ? (
              <AccountButton
                tone="destructive"
                label={t("building.flow.photos.remove")}
                onPress={() => onChange(setPhoto(state, slot, null))}
                testID={`photo-${slot}-remove`}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function ReviewRow({
  title,
  value,
  onPress,
  testID,
}: {
  title: string;
  value: string;
  onPress: () => void;
  testID: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}`}
      onPress={onPress}
      testID={testID}
      style={[
        styles.reviewRow,
        {
          borderColor: colors.border.default,
          paddingVertical: spacing[3],
          paddingHorizontal: spacing[3],
          gap: spacing[1],
        },
      ]}
    >
      <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>{title}</Text>
      <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
        {value}
      </Text>
    </Pressable>
  );
}

function ReviewStep({ state, onChange }: StepProps) {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const questions = visibleQuestions(state.answers);

  function answerText(id: QuestionId): string {
    const value = state.answers[id];
    return value === undefined
      ? t("building.flow.review.unanswered")
      : t(`building.q.${id}.options.${value}`);
  }

  const edit = (ref: StepRef) => onChange(editStep(state, ref));

  return (
    <View style={{ gap: spacing[2] }}>
      <Heading>{t("building.flow.review.title")}</Heading>
      <Meta>{t("building.flow.review.hint")}</Meta>
      {state.mode === "new" ? (
        <>
          <ReviewRow
            title={t("building.flow.review.kind")}
            value={state.kind ? t(`building.flow.kind.${state.kind}`) : "-"}
            onPress={() => edit({ step: "kind" })}
            testID="review-kind"
          />
          <ReviewRow
            title={t("building.flow.review.location")}
            value={
              state.location?.quality === "gps"
                ? t("building.flow.review.locationGps")
                : state.location?.quality === "pin"
                  ? t("building.flow.review.locationPin")
                  : t("building.flow.review.locationTown")
            }
            onPress={() => edit({ step: "location" })}
            testID="review-location"
          />
        </>
      ) : null}
      {questions.map((question) => (
        <ReviewRow
          key={question.id}
          title={t(`building.q.${question.id}.title`)}
          value={answerText(question.id)}
          onPress={() => edit({ step: "question", questionId: question.id })}
          testID={`review-${question.id}`}
        />
      ))}
      {state.mode === "new" ? (
        <Meta>
          {t("building.flow.review.photos", {
            count: localizeDigits(String(photoList(state).length), i18n.language),
          })}
        </Meta>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: "row", gap: 12 },
  footerCell: { flex: 1 },
  photoCard: { borderWidth: 1, borderRadius: 12 },
  thumb: { width: "100%", height: 160, borderRadius: 8 },
  reviewRow: { borderWidth: 1, borderRadius: 10, minHeight: 56 },
});
