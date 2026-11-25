/**
 * The admin tools' one entry module for the screens under `app/admin/`.
 * Each of those screens loads its content from here with
 * `lazyScreenContent(loadAdminArea, ...)` (`area-loader.ts`), so on the
 * web the admin tools are one download of their own, fetched the first time
 * an admin opens them, and are not part of every visitor's first page load.
 * Do not import this module statically.
 *
 * Every page goes through `withAdminTwoStepGate` (security checklist A1.1,
 * migration 0076): while this session has no two-step code, an admin sees
 * "Two-step sign-in needed" instead of the tools, also on a page opened
 * directly by a link.
 */
import { AlertsAdminContent as AlertsAdmin } from "@/features/alerts/components/AlertsAdminContent";
import { ContentFilterContent as ContentFilter } from "@/features/contentfilter/components/ContentFilterContent";
import { LimitedAccountsContent as LimitedAccounts } from "@/features/restrictions/components/LimitedAccountsContent";
import { ActivityContent as Activity } from "./components/ActivityContent";
import { AdminContent as AdminHome } from "./components/AdminContent";
import { withAdminTwoStepGate } from "./components/AdminTwoStepGate";
import { HiddenRemovedContent as HiddenRemoved } from "./components/HiddenRemovedContent";
import { HomeScreenContent as HomeScreen } from "./home/HomeScreenContent";
import { ModerationContent as Moderation } from "./components/ModerationContent";
import { HubsContent as Hubs } from "./hubs/HubsContent";
import { FeedbackDetailContent as FeedbackDetail } from "./inbox/components/FeedbackDetailContent";
import { FeedbackInboxContent as FeedbackInbox } from "./inbox/components/FeedbackInboxContent";
import { PeopleContent as People } from "./people/components/PeopleContent";
import { PersonContent as Person } from "./people/components/PersonContent";
import { FeltPhotoQueueContent as FeltPhotoQueue } from "./photos/components/FeltPhotoQueueContent";
import { StatsContent as Stats } from "./stats/StatsContent";

export const ActivityContent = withAdminTwoStepGate(Activity);
export const AdminContent = withAdminTwoStepGate(AdminHome);
export const HiddenRemovedContent = withAdminTwoStepGate(HiddenRemoved);
export const ModerationContent = withAdminTwoStepGate(Moderation);
export const FeedbackDetailContent = withAdminTwoStepGate(FeedbackDetail);
export const FeedbackInboxContent = withAdminTwoStepGate(FeedbackInbox);
export const FeltPhotoQueueContent = withAdminTwoStepGate(FeltPhotoQueue);
export const PeopleContent = withAdminTwoStepGate(People);
export const PersonContent = withAdminTwoStepGate(Person);
export const HubsContent = withAdminTwoStepGate(Hubs);
export const HomeScreenContent = withAdminTwoStepGate(HomeScreen);
export const StatsContent = withAdminTwoStepGate(Stats);
export const AlertsAdminContent = withAdminTwoStepGate(AlertsAdmin);
export const ContentFilterContent = withAdminTwoStepGate(ContentFilter);
export const LimitedAccountsContent = withAdminTwoStepGate(LimitedAccounts);
