/**
 * The admin tools' one entry module for the screens under `app/admin/`.
 * Each of those screens loads its content from here with
 * `lazyScreenContent(loadAdminArea, ...)` (`area-loader.ts`), so on the
 * web the admin tools are one download of their own, fetched the first time
 * an admin opens them, and are not part of every visitor's first page load.
 * Do not import this module statically.
 */
export { ActivityContent } from "./components/ActivityContent";
export { AdminContent } from "./components/AdminContent";
export { HiddenRemovedContent } from "./components/HiddenRemovedContent";
export { ModerationContent } from "./components/ModerationContent";
export { FeedbackDetailContent } from "./inbox/components/FeedbackDetailContent";
export { FeedbackInboxContent } from "./inbox/components/FeedbackInboxContent";
export { FeltPhotoQueueContent } from "./photos/components/FeltPhotoQueueContent";
export { PeopleContent } from "./people/components/PeopleContent";
export { PersonContent } from "./people/components/PersonContent";
export { HubsContent } from "./hubs/HubsContent";
export { StatsContent } from "./stats/StatsContent";
export { AlertsAdminContent } from "@/features/alerts/components/AlertsAdminContent";
export { ContentFilterContent } from "@/features/contentfilter/components/ContentFilterContent";
export { LimitedAccountsContent } from "@/features/restrictions/components/LimitedAccountsContent";
