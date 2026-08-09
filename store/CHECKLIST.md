# Store-submission checklist

Ordered — do these roughly top to bottom; a few late items can run in parallel
(marked). Each step is tagged **[Peshawa]** (needs his identity, payment, or a
human sign-off only the account owner can give) or **[Dev]** (mobile
tooling / content / CLI work the dev runs end-to-end), matching the ownership
model in PROJECT.md ("the dev handles all mobile tooling end-to-end... never
assume the human will hand-fix JS") and D17 (personal accounts under
Peshawa's name).

## 1. Accounts (blocking everything below)

1. **[Peshawa]** Create an Apple Developer Program account ($99/yr) under
   Peshawa's personal identity — D17. Requires a valid ID and payment method;
   Apple's enrollment can take up to 48h for identity verification.
2. **[Peshawa]** Create a Google Play Console account ($25 one-time) under
   Peshawa's personal identity — D17. Google's new-developer accounts
   currently have a mandatory ~20-testers/14-day closed-testing period before
   production release eligibility — **[VERIFY AT SUBMISSION]**, this policy
   has changed before and affects the timeline, not just a dev-side task.
3. **[Peshawa]** Register `bumelerze.com` and `bumelerze.app` (name-check C1,
   `docs/research/name-trademark-check.md` §5) — cheap, defensive, and
   independent of the store accounts; do this whenever convenient, doesn't
   block anything else here.
4. **[Dev]** Once account credentials exist, run `npx expo login` and
   `eas init` from the repo root — this creates the Expo project record and
   writes `extra.eas.projectId` into `app.config.ts`. That field doesn't
   exist anywhere yet by design (this wave's `eas.json` and `app.config.ts`
   were both left untouched on purpose); `eas init` is what adds it.

## 2. Store name re-check (D5 caveat C2 — do this before creating any store record)

5. **[Dev]** Re-run the store-name availability check from
   `name-trademark-check.md` §2 (iTunes Search API + Play web search) for
   "Bumelerze" / "بوومەلەرزە" / "بوملێرزە" across the storefronts that matter
   (US, IQ, TR, DE at minimum) — confirm nothing claimed the name since
   2026-08-08. Takes minutes; do it fresh, don't trust the cached result once
   real account creation is imminent.
6. **[Dev]** If still clear: create the **App Store Connect app record
   immediately** once account access exists — Apple locks the app name at
   record-creation time, before any build is even uploaded (per the same doc,
   §2). Google Play claims the name at first-publish instead, so there's no
   equivalent early-lock step there — just don't dawdle once testing starts.

## 3. EAS build pipeline

7. **[Dev]** `eas.json` is already authored at the repo root (this wave) —
   three profiles: `development` (dev client, internal), `preview` (internal),
   `production` (store, auto-incrementing build number). No changes needed
   unless the profile shape stops matching reality.
8. **[Dev]** Run `eas build:configure` (idempotent, safe to run even with
   `eas.json` already present) to let EAS CLI validate/adopt the file and set
   up native credentials scaffolding.
9. **[Peshawa]** First interactive credentials setup: `eas build` for iOS the
   first time prompts for Apple ID sign-in (with 2FA) to generate/download the
   distribution certificate and provisioning profile — this step needs
   Peshawa physically present for the 2FA prompt (remote tooling cannot receive his
   Apple ID's SMS/push code). Android's first `eas build` can generate a
   keystore fully non-interactively — no Peshawa step there.
10. **[Dev]** Run the first `development` build (`eas build --profile
    development`) — this is also the point where `expo-dev-client` gets
    installed as a real dependency (this wave's `eas.json` only left a
    comment noting that; installing it is explicitly the dev-build session's
    job, not this one).
11. **[Dev]** Run `preview` builds as needed for informal testing
    (internal distribution — installable via QR code, no store review).
12. **[Dev]** Run the first `production` build once the app is feature-
    complete for v1 (`eas build --profile production`).

## 4. TestFlight / internal testing

13. **[Dev]** `eas submit --platform ios --profile production` uploads the
    build to App Store Connect / TestFlight.
14. **[Peshawa]** Accept the current Apple Developer Program License
    Agreement if prompted (Apple periodically updates this and blocks builds
    until the account holder re-accepts it in App Store Connect — only he can
    click this).
15. **[Dev]** Add internal testers in App Store Connect (email-based, up to
    100, no review needed) and share the TestFlight build for Peshawa's own
    on-device test — this is also the natural moment to finally close the
    "on-device check DEFERRED" item from `docs/plan.md` Phase 1.
16. **[Dev]** `eas submit --platform android --profile production` uploads
    to Play Console; set up an **Internal testing** track (Play's fastest,
    no-review tier) the same way before touching production/closed tracks.

## 5. Store listing records

17. **[Dev]** Paste the listing content from `store/listing/*.md` into App
    Store Connect and Play Console, following the store-locale mapping
    guidance in `store/listing/README.md` (Apple has no Kurdish locale slot;
    Play's Kurdish-locale support needs a live check).
18. **[Dev]** Upload screenshots per `store/screenshots/PLAN.md` once
    captured (post-dev-build, not yet done as of this wave).
19. **[Dev]** Set category = **Weather** (primary) on both stores, +
    **Utilities** (Apple secondary) — reasoning and the
    "verify against comparable apps" note in `store/listing/README.md`.
20. **[Peshawa]** Complete Apple's age-rating questionnaire and Google Play's
    IARC content questionnaire — both stores require the *account holder* (or
    someone Apple/Google consider authorized) to certify content-rating
    answers; we can draft the expected answers (`store/listing/README.md`
    "Age rating notes") but the actual form submission is an account action.
21. **[Peshawa]** Complete Google Play's **Data safety** form and Apple's
    **App Privacy** nutrition labels using `store/listing/README.md`'s
    privacy summary as the source of truth — same reasoning as #20, these are
    account-holder certifications, not just content that can be pasted in
    unsupervised the first time (subsequent updates to already-approved
    labels can likely be delegated once Peshawa has done the first pass and
    is comfortable with the mapping).

## 6. Review notes (draft now, paste at submission)

22. **[Dev]** Draft App Review notes covering the two things reviewers are
    most likely to ask about for a regional earthquake app:
    - **"Is this an earthquake-prediction app?"** — No. Both Apple and Google
      have specifically cracked down on earthquake-*prediction* apps in the
      past (a recurring source of scam/pseudoscience apps, especially after
      major regional earthquakes draw public anxiety). Bumelerze explicitly
      does **not** do early warning/prediction in v1 (D6, `spec-v1.md` §1):
      it reports events **after** they happen, from published USGS/EMSC data
      plus the team's own post-event ShakeMap computation. State this
      plainly and upfront in the review notes rather than waiting to be
      asked.
    - **"What's the scientific basis for the ShakeMaps/intensity claims?"** —
      EMS-98 intensity scale (D7), ShakeMaps computed via the team's own
      GMPE-based engine (`bumelerze-shake-service`, D9/D19/D20, built on
      `openquake.hazardlib`), built and maintained by a seismic-risk PhD
      researcher who works on the Zagros/Iraq region professionally. Every
      ShakeMap in-app shows its data sources and automatic-vs-reviewed
      status (`shakemap.reviewStatus` strings, already in the app) — point
      reviewers at that in-app transparency rather than just asserting
      credibility in prose.
    - No demo account needed — the app requires no sign-up for any feature
      (PROJECT.md hard requirement); note this explicitly so reviewers don't
      go looking for a login screen.
23. **[Dev]** Keep these notes in sync with whatever the actual v1 feature
    set looks like at submission time — this wave's draft is accurate to
    2026-08-09's built features; re-read it against `docs/plan.md`'s
    current phase status before pasting into App Store Connect.

## Not in scope for this checklist

- EAS Update / OTA runtime-version policy — separate future task, not a
  submission blocker for the first release.
- Formal trademark filings (name-check C3) — explicitly deferred until a
  legal entity exists (D17), unrelated to store submission timing.
