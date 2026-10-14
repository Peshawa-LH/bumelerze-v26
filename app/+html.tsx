import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

import { APP_ORIGIN, APP_SHARE_DESCRIPTION, OG_IMAGE_URL } from "@/config/urls";

/**
 * The HTML page around the web app (Expo Router's custom root HTML; rendered
 * once at build time, so everything here is the same for every language and
 * every route). Carries the Open Graph and Twitter tags that messengers and
 * social apps read when a link to the app is shared (D-1): the share links
 * now land here directly, so a shared earthquake unfurls to the app's name,
 * one sentence and the brand picture instead of "Page not found".
 *
 * Expo renders this file for a STATIC export only; the hosted build is a
 * single-page export (app.config.ts `web.output`), for which Expo takes
 * `public/index.html` instead. That file is this page as plain HTML; the
 * html-shell test keeps the two in step.
 *
 * No `theme-color`: Safari would colour its bars with it, and the manifest
 * deliberately has none (review note 11.2, the bars stayed red). The build
 * script stamps `<meta name="bumelerze-build">` right after `<head>`, so that
 * tag must stay literal here.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <title>Bumelerze</title>
        <meta name="description" content={APP_SHARE_DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Bumelerze" />
        <meta property="og:title" content="Bumelerze" />
        <meta property="og:description" content={APP_SHARE_DESCRIPTION} />
        <meta property="og:url" content={`${APP_ORIGIN}/`} />
        <meta property="og:image" content={OG_IMAGE_URL} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Bumelerze" />
        <meta name="twitter:description" content={APP_SHARE_DESCRIPTION} />
        <meta name="twitter:image" content={OG_IMAGE_URL} />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
