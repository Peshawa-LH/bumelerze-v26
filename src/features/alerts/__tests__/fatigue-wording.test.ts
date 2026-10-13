/**
 * Review note 11.5: "Alerts are limited during aftershock sequences" was
 * replaced by a plain explanation with the real numbers. This ties the
 * English text to the rule the planner actually runs (alert_rules() and
 * alert_plan_event() of migration 0062), so changing one without the other
 * fails here. The other locales are drafts of the same sentence.
 */
import en from "@/i18n/locales/en.json";

import { functionSource, readCode } from "../../../../supabase/migrations/sql-test-utils";

const sql = readCode("0062_alert_sender.sql");
const rules = functionSource(sql, "alert_rules");
const plan = functionSource(sql, "alert_plan_event");
const summaries = functionSource(sql, "alert_plan_summaries");
const text = en.notificationSettings.fatigueFooter;

describe("the 'how many alerts' text matches the planner", () => {
  it("mainshock: magnitude 5 or more, within 100 km, the 3 days (72 h) before", () => {
    expect(rules).toContain("'mainshock_min_magnitude', 5.0");
    expect(rules).toContain("'sequence_km', 100");
    expect(rules).toContain("'sequence_hours', 72");
    expect(plan).toContain("m.magnitude >= 5.0");
    expect(plan).toContain("interval '72 hours'");
    expect(plan).toMatch(/alert_distance_km\(m\.lat, m\.lon, ev\.lat, ev\.lon\) <= 100/);
    expect(text).toContain("(magnitude 5 or more)");
    expect(text).toContain("for the next 3 days and within 100 km");
  });

  it("an aftershock alerts only if at most half a magnitude below the mainshock (or as strong)", () => {
    expect(rules).toContain("'mainshock_margin', 0.5");
    expect(plan).toContain("ev.magnitude < greatest(v_main - 0.5, v_floor + 1.0)");
    expect(text).toContain("at most half a magnitude smaller");
  });

  it("at most 3 an hour, except a new, stronger mainshock", () => {
    expect(rules).toContain("'rate_cap_per_hour', 3");
    expect(plan).toContain("v_recent >= 3");
    expect(plan).toContain("interval '1 hour'");
    expect(plan).toContain("elsif not v_new_main then");
    expect(text).toContain("at most 3 alerts an hour");
    expect(text).toContain("A new, stronger earthquake always comes through.");
  });

  it("the rest: one quiet summary, at most one every 12 hours", () => {
    expect(rules).toContain("'summary_every_hours', 12");
    expect(summaries).toContain("interval '12 hours'");
    expect(text).toContain("one quiet summary, at most one every 12 hours");
  });
});
