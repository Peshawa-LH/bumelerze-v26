/*
 * Forwards from bumelerze.com to the app at app.bumelerze.com.
 *
 * bumelerze.com (GitHub Pages) hosts the website only. The app moved to
 * https://app.bumelerze.com in 2026-10, and the site keeps two kinds of old
 * or short links working by forwarding them in the browser:
 *
 *   /app, /app/<path>        the app's old address -> the same path on the app
 *   /e/<eventId>             short event link      -> /event/<eventId>
 *   /u/<username>            short profile link    -> /u/<username>
 *   /join?code=…&key=…       short family-join link -> /home/join?code=…&key=…
 *
 * The query and the hash always travel along unchanged. Anything else is
 * not ours to forward (null): the 404 page then says "page not found".
 *
 * Plain ES5 on purpose: scripts/build-website.mjs inlines this file into
 * website/404.html and website/app/index.html, and the website tests run it
 * in a sandbox (src/__tests__/website-build.test.ts).
 */
var APP_ORIGIN = "https://app.bumelerze.com";

function appRedirect(pathname, search, hash) {
  var rest = search || "";
  rest += hash || "";
  var m;
  if (pathname === "/app" || pathname.indexOf("/app/") === 0) {
    var inner = pathname.slice(5);
    if (inner === "index.html") inner = "";
    return APP_ORIGIN + "/" + inner + rest;
  }
  if ((m = /^\/e\/([^/]+)\/?$/.exec(pathname))) {
    return APP_ORIGIN + "/event/" + m[1] + rest;
  }
  if ((m = /^\/u\/([^/]+)\/?$/.exec(pathname))) {
    return APP_ORIGIN + "/u/" + m[1] + rest;
  }
  if (/^\/join\/?$/.test(pathname)) {
    return APP_ORIGIN + "/home/join" + rest;
  }
  return null;
}
