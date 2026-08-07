"""usgs_products — fetch USGS event-detail-derived ShakeMap/DYFI product
inputs for one event, by external catalog id (D21 "dual backend" wave,
`docs/decisions.md`: "the service both reads USGS ShakeMaps AND computes
its own"; `worker/pipeline.py`'s "fetch available USGS data" step).

Mirrors `scripts/run_validation.py`'s own detail -> `resolve_product` ->
contents-URL fetch pattern (same approach, independently reproduced here —
`scripts/` is a standalone CLI tree, never imported by installable
`shake_service` package code, so this module owns its own copy of the small
`resolve_product` selection rule rather than reaching across that
boundary). No local disk cache (unlike `run_validation.py`'s `--cache-dir`,
built for iterative CLI development against the same event over and over) —
this module is called once per real pipeline recompute.

Every fetch goes through one injectable `fetch_text: (url, params=None) ->
str` seam (mirrors `scripts/run_worker.py`'s own `fetch_fn` convention) so
`worker/pipeline.py`'s tests never need real network access; `no_usgs_products`
is `run_pipeline`'s own zero-network default (see its docstring) — real
wiring (network-enabled) is explicit, done by `scripts/run_worker.py` and
`scripts/seed_atlas.py`, never implicit inside the package.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

import requests

DETAIL_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
REQUEST_TIMEOUT_S = 60

FetchTextFn = Callable[..., str]  # (url: str, params: dict | None = None) -> response text


def default_fetch_text(url: str, params: dict[str, Any] | None = None) -> str:
    response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    return response.text


def resolve_product(
    detail: dict[str, Any], product_type: str, *, preferred_source: str,
) -> dict[str, Any] | None:
    """The preferred product of `product_type` (e.g. `"shakemap"`, `"dyfi"`)
    from a USGS event `detail` payload — `source == preferred_source` if
    present, else the highest-`preferredWeight` product, else `None` if the
    event has no product of this type at all (never raises on a missing
    product). Same selection rule as `scripts/run_validation.py`'s own
    `resolve_product` — see module docstring for why it is reproduced here
    rather than imported."""
    products = detail.get("properties", {}).get("products", {})
    candidates = products.get(product_type)
    if not candidates:
        return None
    preferred = [p for p in candidates if p.get("source") == preferred_source]
    if preferred:
        return preferred[0]
    return max(candidates, key=lambda p: p.get("preferredWeight", -1))


@dataclass(frozen=True)
class UsgsEventProducts:
    """Whatever USGS ShakeMap/DYFI product content one event actually has —
    every field defaults to "nothing available" so `no_usgs_products`
    (`run_pipeline`'s zero-network default) is a one-line construction."""

    event_id: str
    shakemap_available: bool = False
    shakemap_product_id: str | None = None
    grid_xml_text: str | None = None
    stationlist_text: str | None = None
    dyfi_available: bool = False
    dyfi_product_id: str | None = None
    dyfi_geo_10km_text: str | None = None


def no_usgs_products(event_id: str) -> UsgsEventProducts:
    """`worker/pipeline.run_pipeline`'s default `usgs_products_fetcher` —
    deliberately does ZERO network I/O, so calling `run_pipeline` without
    explicitly wiring a fetcher (every existing test, plus any future
    caller that hasn't opted in) never makes a real HTTP request. Real
    wiring: `scripts/run_worker.py`/`scripts/seed_atlas.py` pass
    `fetch_usgs_event_products` (optionally with a custom `fetch_text`)
    explicitly."""
    return UsgsEventProducts(event_id=event_id)


def fetch_usgs_event_products(
    event_id: str, *, fetch_text: FetchTextFn = default_fetch_text,
) -> UsgsEventProducts:
    """Fetch the event detail, then whatever shakemap (`grid.xml` +
    `stationlist.json`) / dyfi (`dyfi_geo_10km.geojson`) product contents it
    actually has. Never raises on a missing product — availability is
    reported via the `*_available` flags, not an error, same convention as
    `run_validation.fetch_event_inputs`."""
    detail_text = fetch_text(DETAIL_URL, {"eventid": event_id, "format": "geojson"})
    detail = json.loads(detail_text)

    shakemap_product = resolve_product(detail, "shakemap", preferred_source="atlas")
    grid_xml_text: str | None = None
    stationlist_text: str | None = None
    if shakemap_product is not None:
        contents = shakemap_product.get("contents", {})
        if "download/grid.xml" in contents:
            grid_xml_text = fetch_text(contents["download/grid.xml"]["url"])
        if "download/stationlist.json" in contents:
            stationlist_text = fetch_text(contents["download/stationlist.json"]["url"])

    dyfi_product = resolve_product(detail, "dyfi", preferred_source="us")
    dyfi_geo_10km_text: str | None = None
    if dyfi_product is not None:
        contents = dyfi_product.get("contents", {})
        if "dyfi_geo_10km.geojson" in contents:
            dyfi_geo_10km_text = fetch_text(contents["dyfi_geo_10km.geojson"]["url"])

    return UsgsEventProducts(
        event_id=event_id,
        shakemap_available=grid_xml_text is not None,
        shakemap_product_id=str(shakemap_product.get("id", "")) if shakemap_product else None,
        grid_xml_text=grid_xml_text,
        stationlist_text=stationlist_text,
        dyfi_available=dyfi_geo_10km_text is not None,
        dyfi_product_id=str(dyfi_product.get("id", "")) if dyfi_product else None,
        dyfi_geo_10km_text=dyfi_geo_10km_text,
    )
