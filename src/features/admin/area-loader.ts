import * as area from "./area";

/** iOS/Android and tests: the area is part of the app, ready at once. The
 * web version (`area-loader.web.ts`) downloads it on first use. */
export function loadAdminArea(): typeof area {
  return area;
}
