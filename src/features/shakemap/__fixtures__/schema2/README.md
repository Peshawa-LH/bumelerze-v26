# Schema 2 risk fixture

`risk_summary.json` is a real `bumelerze-engine` product-schema-2 summary
for the 2017 Iran-Iraq border event (M7.3, bare prior), trimmed to the
eight most damaged IMS-25 types and to the fields the app parses. The
numbers are the engine's own, not invented, so the tests assert against
behaviour the engine actually produces.

Its counterpart, `../us6000jllz/risk_summary.json`, is a schema 1 product
and stays that way on purpose: every version published before the Atlas is
recomputed is schema 1, and the dashboard has to keep rendering for them.
