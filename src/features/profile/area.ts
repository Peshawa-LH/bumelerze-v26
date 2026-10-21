/**
 * People and homes: the one entry module for the Profile tab, public
 * profiles, badges, activity, follow lists, Find people and the "Tag my building"
 * screens. They load their content from here through `loadProfileArea`
 * (`area-loader.ts`), so on the web this part of the app is one download of
 * its own, fetched the first time one of these screens opens, and is not in
 * the first page load that shows the earthquake list. Do not import this
 * module statically.
 */
export { ProfileByUsername } from "./components/ProfileByUsername";
export { ProfileTab } from "./components/ProfileTab";
export { ActivityBell } from "@/features/activity/components/ActivityBell";
export { ActivityContent } from "@/features/activity/components/ActivityContent";
export { BadgesSection } from "@/features/badges/components/BadgesSection";
export { FamilyScreen } from "@/features/building/components/FamilyScreen";
export { HomeReportScreen } from "@/features/building/components/HomeReport";
export { JoinScreen } from "@/features/building/components/JoinScreen";
export { MyHomeCard } from "@/features/building/components/MyHomeCard";
export { NewHomeScreen } from "@/features/building/components/NewHomeScreen";
export { TrashedHomesSection } from "@/features/building/components/TrashedHomesSection";
export { BlockedSection } from "@/features/community/components/BlockedSection";
export { FollowRequestsSection } from "@/features/community/components/FollowRequestsSection";
export { PeopleList } from "@/features/community/components/PeopleList";
export { ProfileShareSheet } from "@/features/community/components/ProfileShareSheet";
export { MutedSection } from "@/features/mute/components/MutedSection";
export { PeopleSearch } from "@/features/people-search/components/PeopleSearch";
