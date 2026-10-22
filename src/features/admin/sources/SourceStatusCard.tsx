import type { TFunction } from "i18next";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  formatRelativeTimeValue,
  getRelativeTime,
  isolateNumeric,
} from "@/features/events";
import { useTheme } from "@/theme";
import { formatCount } from "../people/format";
import { ToolCard } from "../ui";
import { useTextDir } from "../ui/text-dir";
import { useSourceStatus } from "./queries";
import type {
  SourceRow,
  SourceStatus,
  SourceStatusTransport,
  WorkerLine,
} from "./transport";

/** First-strong isolate: server error text (English, URLs) inside a Sorani
 * or Arabic line keeps its own direction. */
const FSI = "⁨";
const PDI = "⁩";
const ERROR_MAX_LENGTH = 120;

/** Kinds that have their own row; any other open alert only counts. */
const ROW_ALERT_KINDS = new Set(["feed_stale", "shake_dispatch"]);

type Tone = "ok" | "attention" | "quiet";

interface StatusRow {
  key: string;
  name: string;
  tone: Tone;
  lines: string[];
}

function agoText(t: TFunction, locale: string, timeMs: number, now: number): string {
  const relative = getRelativeTime(timeMs, now);
  return relative.unit === "justNow"
    ? t("events.relativeTime.justNow")
    : t(`events.relativeTime.${relative.unit}`, {
        value: formatRelativeTimeValue(relative.value, locale),
      });
}

function sourceRow(
  t: TFunction,
  locale: string,
  source: SourceRow,
  now: number,
): StatusRow {
  const lines: string[] = [];
  if (source.lastOkAt === null) {
    lines.push(t("admin.sources.noData"));
  } else {
    const ago = agoText(t, locale, source.lastOkAt, now);
    lines.push(t(source.late ? "admin.sources.late" : "admin.sources.lastData", { ago }));
  }
  if (source.alertOpenedAt !== null) {
    lines.push(
      t("admin.sources.alertOpened", {
        ago: agoText(t, locale, source.alertOpenedAt, now),
      }),
    );
  }
  if (
    source.late &&
    source.lastError &&
    (source.lastErrorAt ?? 0) >= (source.lastOkAt ?? 0)
  ) {
    lines.push(
      t("admin.sources.lastError", {
        error: `${FSI}${source.lastError.slice(0, ERROR_MAX_LENGTH)}${PDI}`,
      }),
    );
  }
  return {
    key: source.provider,
    name: t(`admin.sources.providers.${source.provider}`),
    tone: source.late ? "attention" : source.lastOkAt === null ? "quiet" : "ok",
    lines,
  };
}

function workerRow(
  t: TFunction,
  locale: string,
  worker: WorkerLine,
  now: number,
): StatusRow {
  const base = { key: "worker", name: t("admin.sources.worker.name") };
  if (!worker.tokenSet) {
    return { ...base, tone: "quiet", lines: [t("admin.sources.worker.noToken")] };
  }
  if (worker.failures > 0) {
    return {
      ...base,
      tone: "attention",
      lines: [
        t("admin.sources.worker.failing", {
          number: formatCount(worker.failures, locale),
        }),
        t("admin.sources.worker.lastAnswer", {
          answer:
            worker.lastStatus === null
              ? t("admin.sources.worker.noAnswer")
              : isolateNumeric(`GitHub ${worker.lastStatus}`),
        }),
      ],
    };
  }
  if (worker.lastDispatchedAt === null) {
    return { ...base, tone: "ok", lines: [t("admin.sources.worker.ready")] };
  }
  const ago = agoText(t, locale, worker.lastDispatchedAt, now);
  const lines = [
    t(
      worker.lastOutcome === "sent"
        ? "admin.sources.worker.starting"
        : "admin.sources.worker.started",
      { ago },
    ),
  ];
  if (worker.pending) {
    lines.push(t("admin.sources.worker.queued"));
  }
  return { ...base, tone: "ok", lines };
}

/** The rows and the count of what needs attention, from one status answer. */
export function sourceStatusRows(
  t: TFunction,
  locale: string,
  status: SourceStatus,
  now: number,
): { rows: StatusRow[]; attention: number } {
  const rows = status.sources.map((source) => sourceRow(t, locale, source, now));
  if (status.worker) {
    rows.push(workerRow(t, locale, status.worker, now));
  }
  const other = status.openAlerts.filter(
    (alert) => !ROW_ALERT_KINDS.has(alert.kind),
  ).length;
  return {
    rows,
    attention: rows.filter((row) => row.tone === "attention").length + other,
  };
}

/**
 * Admin home, for the statistics ranks (`stats.read`): every feed the server
 * reads, how long ago it last delivered, and the SHAKEmap worker's last start
 * (migrations 0070 and 0072). Read-only like the rest of the launcher; the
 * watchdog's push opens this page. The dot only repeats what the words say.
 */
export function SourceStatusCard({
  transport,
}: {
  transport?: SourceStatusTransport | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const query = useSourceStatus(true, transport);
  const locale = i18n.language;
  const title = t("admin.sources.title");

  if (!query.data) {
    return (
      <ToolCard title={title} testID="admin-sources">
        <Text
          testID="admin-sources-message"
          style={[typography.bodyMeta, dir, { color: colors.text.secondary }]}
        >
          {query.isError ? t("admin.sources.unavailable") : t("admin.sources.loading")}
        </Text>
      </ToolCard>
    );
  }

  // "ago" is measured from the server's clock at the time it answered (the
  // query asks again every minute), not the phone's, which may be wrong.
  const now = query.data.checkedAt ?? query.dataUpdatedAt;
  const { rows, attention } = sourceStatusRows(t, locale, query.data, now);
  const dotColor: Record<Tone, string> = {
    ok: colors.status.success,
    attention: colors.status.warning,
    quiet: colors.border.default,
  };
  return (
    <ToolCard
      title={title}
      subtitle={
        attention === 0
          ? t("admin.sources.allFine")
          : t("admin.sources.needAttention", { number: formatCount(attention, locale) })
      }
      testID="admin-sources"
    >
      {rows.map((row) => (
        <View
          key={row.key}
          testID={`admin-source-${row.key}`}
          accessible
          accessibilityLabel={`${row.name}: ${row.lines.join(". ")}`}
          style={[styles.row, { gap: spacing[2] }]}
        >
          <View
            style={[styles.dot, { backgroundColor: dotColor[row.tone] }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <View style={styles.texts}>
            <Text
              style={[
                typography.bodyDefault,
                dir,
                styles.name,
                { color: colors.text.primary },
              ]}
            >
              {row.name}
            </Text>
            {row.lines.map((line, index) => (
              <Text
                key={index}
                style={[
                  typography.bodyMeta,
                  dir,
                  {
                    color:
                      row.tone === "attention"
                        ? colors.text.primary
                        : colors.text.secondary,
                  },
                ]}
              >
                {line}
              </Text>
            ))}
          </View>
        </View>
      ))}
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 7 },
  texts: { flex: 1, gap: 2 },
  name: { fontWeight: "600" },
});
