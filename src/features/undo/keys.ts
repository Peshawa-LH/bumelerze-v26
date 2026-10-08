/** Query key prefix of the Profile page's "Recently deleted" list (migration
 * 0053). Own file, no imports: the hub, posts and community code invalidate it
 * after a delete or a restore without importing the feature that owns it. */
export const RECENTLY_DELETED_KEY = ["community", "recentlyDeleted"] as const;
