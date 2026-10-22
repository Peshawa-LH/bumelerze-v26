# send-alerts

Supabase Edge Function (Deno) that delivers earthquake alerts (migration
0062). The database decides everything; this function only sends.

- pg_cron job `send_alerts` posts `{}` here every minute while
  `public.alert_work_pending()` is true.
- `alert_plan_run()` plans queued events (rollout gate off | testers | public,
  tiers, near me / another place, one alert per event per device, the D16
  aftershock guard and 3-an-hour cap, 12 h summaries) and hands back a batch.
- The batch goes out by web push (VAPID, `npm:web-push`) or the Expo push API;
  `alert_record_results()` stores sent / gone / retry / failed, and the Expo
  ticket id of an accepted phone push (migration 0068). 404/410 and Expo
  `DeviceNotRegistered` switch the device off.
- Expo receipts (migration 0068): after sending, each call asks Expo for the
  receipts that are due (`alert_receipts_due()`, 15 minutes after the send,
  held 5 minutes while being checked, given up after 23 hours) and stores
  them with `alert_record_receipts()`: `DeviceNotRegistered` switches the
  phone off, other receipt errors mark the delivery failed without blaming
  the phone, a missing receipt is asked again later. `alert_work_pending()`
  wakes the cron job for due receipts. Before 0068 is applied the answer
  says `receipts: "unavailable"` and sending works as before.
- iOS: an alert or update for an earthquake of magnitude 5.0 or more goes out
  with `interruptionLevel: "time-sensitive"` (needs the app's Time Sensitive
  Notifications entitlement to take effect).
- Operations notices (migration 0070): when the feed watchdog opens an alert
  (or starting the SHAKEmap worker keeps failing, 0072), the database queues
  a delivery of kind `ops` to every active device of an account that reads
  statistics (official and admin), at most one per device per hour. It
  carries no event; the text is fixed ("A data source needs attention") and
  opens the admin home, whose Source status card says which source. Deploy
  this function before applying 0070: an older one records an `ops`
  delivery as malformed (failed).
- It takes no targeting input, so calling it can only drain the queue sooner.

## Health and the key self-check

`GET` (or `POST {"health": true}`) answers
`{"data": {"requestId", "mode", "keys"}}` and does nothing else. `mode` is the
rollout (`off` | `testers` | `public`); `keys` is `ok`, `mismatch` or
`missing`, never a key value:

- the public key is derived from `VAPID_PRIVATE_KEY` (P-256, uncompressed
  point, base64url, `vapid-check.ts`) and compared with `VAPID_PUBLIC_KEY`
  and with the key the app subscribes with (`app-key.ts`, the one copy;
  a test checks `scripts/build-app-web.sh` and `netlify.toml` carry it too);
- on `mismatch` or `missing` a send is refused before anything is planned or
  claimed (`500 vapid_keys` / `misconfigured`), so the queue simply waits.

## Deploy

```
supabase functions deploy send-alerts --no-verify-jwt
```

Entrypoint: `index.ts` (Deno wiring only). It imports `handler.ts`,
`run.ts`, `plan.ts`, `senders.ts`, `receipts.ts`, `message.ts`, `strings.ts`,
`gazetteer-data.ts`, `vapid-check.ts` and `app-key.ts`, all by relative path,
so a wrapper that imports `index.ts` from a pinned commit needs nothing else.

Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
(`mailto:dev@bumelerze.com`); optional `EXPO_ACCESS_TOKEN`. Without the VAPID
secrets the function answers 500 before claiming anything, so nothing is lost.
The app build carries only the public key (`EXPO_PUBLIC_VAPID_PUBLIC_KEY`).

## Text

Titles and bodies are localized here (ckb, kmr, ar, en) from `strings.ts` and
`gazetteer-data.ts`, copies of the app's locale strings and gazetteer made by
`node scripts/generate-send-alerts-data.mjs`. `__tests__/vendored-sync.test.ts`
fails if they drift from the app. The place line is ours ("20 km SE of Hawler,
Kurdistan (Iraq)"), never a provider's.

## Tests

`npx jest supabase/functions/send-alerts`: message text in four languages,
status mapping, endpoint allowlist, Expo tickets and receipts, batching, malformed plans,
the key self-check against Node's own P-256 derivation, the health answer and
the refusal on mismatch, and a testers-mode dry run of a regional event.
