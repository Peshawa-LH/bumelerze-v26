import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Text fields never sit under the keyboard on iOS (item 47 of the iOS
 * parity inventory). Jest cannot show a keyboard, so this is a source rule:
 * every file with a `TextInput` is listed with the screen scroll view or
 * sheet that holds it, and each of those spreads `KEYBOARD_AWARE_SCROLL`
 * or rises with a `KeyboardAvoidingView`. A new form fails here until its
 * host is named.
 */

const ROOT = join(__dirname, "..", "..", "..");

function collect(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith("__") || entry.startsWith(".")) {
        continue;
      }
      collect(full, files);
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const PROFILE_HOSTS = [
  "app/(tabs)/(profile)/profile.tsx",
  "app/(tabs)/(home,map,sensor,profile,settings)/u/[username]/index.tsx",
];
const SHEET = "src/features/admin/people/components/Sheet.tsx";
const TOOL_PAGE = "src/features/admin/ui/ToolPage.tsx";

/** File with a TextInput -> where it is shown. */
const FORM_HOSTS: Record<string, string[]> = {
  "app/feedback.tsx": ["app/feedback.tsx"],
  "app/felt-report/details.tsx": ["app/felt-report/details.tsx"],
  "src/features/account/components/AuthField.tsx": [
    "app/account/sign-in.tsx",
    "app/account/password.tsx",
  ],
  "src/features/account/components/ProfileForm.tsx": ["app/account/profile.tsx"],
  "src/features/admin/components/ActivityContent.tsx": [
    "src/features/admin/components/ActivityContent.tsx",
  ],
  "src/features/admin/hubs/HubsContent.tsx": [TOOL_PAGE],
  "src/features/admin/inbox/components/FeedbackDetailContent.tsx": [
    "src/features/admin/inbox/components/FeedbackDetailContent.tsx",
  ],
  "src/features/admin/inbox/components/FeedbackInboxContent.tsx": [
    "src/features/admin/inbox/components/FeedbackInboxContent.tsx",
  ],
  "src/features/admin/people/components/BadgeSheet.tsx": [SHEET],
  "src/features/admin/people/components/PeopleContent.tsx": [
    "src/features/admin/people/components/PeopleContent.tsx",
  ],
  "src/features/admin/people/components/PeopleFilterSheet.tsx": [SHEET],
  "src/features/alerts/components/AlertsAdminContent.tsx": [
    "src/features/alerts/components/AlertsAdminContent.tsx",
  ],
  "src/features/admin/people/components/PersonNotes.tsx": [
    "src/features/admin/people/components/PersonContent.tsx",
  ],
  "src/features/building/components/ui.tsx": ["src/features/building/components/ui.tsx"],
  "src/features/catalog/components/NumericStepper.tsx": [
    "src/features/catalog/components/CatalogListScreen.tsx",
  ],
  "src/features/contentfilter/components/ContentFilterContent.tsx": [
    "src/features/contentfilter/components/ContentFilterContent.tsx",
  ],
  "src/features/eventhub/components/CommentComposer.tsx": [
    "src/features/eventhub/components/EventHubContent.tsx",
    ...PROFILE_HOSTS,
  ],
  "src/features/geo/components/PlaceSearch.tsx": [
    "app/felt-report/index.tsx",
    "app/(tabs)/(settings)/settings.tsx",
    "app/(tabs)/(home,map,sensor,profile,settings)/notification-settings.tsx",
    "app/account/profile.tsx",
    "src/features/building/components/ui.tsx",
  ],
  "src/features/handbook/components/CoordinateInputForm.tsx": [
    "src/features/handbook/components/HandbookScreen.tsx",
  ],
  "src/features/handbook/spectrum/components/SpectrumInputsForm.tsx": [
    "src/features/handbook/components/HandbookScreen.tsx",
  ],
  "src/features/posts/components/PostComposer.tsx": PROFILE_HOSTS,
  "src/features/posts/components/PostItem.tsx": PROFILE_HOSTS,
  "src/features/reporting/ReportSheet.tsx": [SHEET],
  "src/features/restrictions/components/LimitAccountSheet.tsx": [
    "src/features/restrictions/components/LimitAccountSheet.tsx",
  ],
  "src/features/restrictions/components/ReviewSheet.tsx": [
    "src/features/restrictions/components/ReviewSheet.tsx",
  ],
  "src/features/share/ShareSheet.tsx": ["src/features/share/ShareSheet.tsx"],
};

describe("keyboard and text fields (source scan)", () => {
  it("[regression] every file with a TextInput names the screen or sheet that holds it", () => {
    const withInput = ["app", "src"]
      .flatMap((dir) => collect(join(ROOT, dir)))
      .filter((file) => /<TextInput\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file))
      .sort();
    expect(withInput).toEqual(Object.keys(FORM_HOSTS).sort());
  });

  it("[regression] every such screen or sheet keeps its fields above the keyboard", () => {
    const hosts = [...new Set(Object.values(FORM_HOSTS).flat())];
    const unaware = hosts.filter((host) => {
      const source = readFileSync(join(ROOT, host), "utf8");
      return !/\{\.\.\.KEYBOARD_AWARE_SCROLL\}|<KeyboardAvoidingView\b/.test(source);
    });
    expect(unaware).toEqual([]);
  });
});
