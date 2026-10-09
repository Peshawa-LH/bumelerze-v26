# send-alerts

Supabase Edge Function (Deno) that delivers earthquake alerts (migration
0062). The database decides everything; this function only sends.

- pg_cron job `send_alerts` posts `{}` here every minute while
  `public.alert_work_pending()` is true.
- `alert_plan_run()` plans queued events (rollout gate off | testers | public,
  tiers, near me / another place, one alert per event per device, the D16
  aftershock guard and 3-an-hour cap, 12 h summaries) and hands back a batch.
- The batch goes out by web push (VAPID, `npm:web-push`) or the Expo push API;
  `alert_record_results()` stores sent / gone / retry / failed. 404/410 and
  Expo `DeviceNotRegistered` switch the device off.
- It takes no targeting input, so calling it can only drain the queue sooner.

## Deploy

```
supabase functions deploy send-alerts --no-verify-jwt
```

Files: `index.ts`, `run.ts`, `plan.ts`, `senders.ts`, `message.ts`,
`strings.ts`, `gazetteer-data.ts`.

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
status mapping, endpoint allowlist, Expo tickets, batching, malformed plans.
