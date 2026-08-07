"""usgs_products.py: detail -> product-content fetch wiring, fully mocked
(no network), plus the zero-network `no_usgs_products` default."""

from __future__ import annotations

import json

import pytest

from shake_service.worker import usgs_products


def _detail(*, shakemap=None, dyfi=None):
    products = {}
    if shakemap is not None:
        products["shakemap"] = shakemap
    if dyfi is not None:
        products["dyfi"] = dyfi
    return json.dumps({"properties": {"products": products}})


SHAKEMAP_ENTRY = {
    "id": "urn:shakemap:atlas:1",
    "source": "atlas",
    "preferredWeight": 100,
    "contents": {
        "download/grid.xml": {"url": "https://example.com/grid.xml"},
        "download/stationlist.json": {"url": "https://example.com/stationlist.json"},
    },
}

SHAKEMAP_ENTRY_WITH_RUPTURE = {
    **SHAKEMAP_ENTRY,
    "contents": {
        **SHAKEMAP_ENTRY["contents"],
        "download/rupture.json": {"url": "https://example.com/rupture.json"},
    },
}

DYFI_ENTRY = {
    "id": "urn:dyfi:us:1",
    "source": "us",
    "preferredWeight": 50,
    "contents": {
        "dyfi_geo_10km.geojson": {"url": "https://example.com/dyfi_geo_10km.geojson"},
    },
}


def _fake_fetch(routes: dict[str, str]):
    calls = []

    def fetch(url, params=None):
        calls.append((url, params))
        return routes[url]

    return fetch, calls


# ---------------------------------------------------------------------------
# resolve_product
# ---------------------------------------------------------------------------


def test_resolve_product_prefers_the_named_source():
    detail = {
        "properties": {
            "products": {
                "shakemap": [
                    {"source": "us", "preferredWeight": 999},
                    {"source": "atlas", "preferredWeight": 1},
                ]
            }
        }
    }
    picked = usgs_products.resolve_product(detail, "shakemap", preferred_source="atlas")
    assert picked["source"] == "atlas"


def test_resolve_product_falls_back_to_highest_preferred_weight():
    detail = {
        "properties": {
            "products": {
                "shakemap": [
                    {"source": "us", "preferredWeight": 5},
                    {"source": "us2", "preferredWeight": 9},
                ]
            }
        }
    }
    picked = usgs_products.resolve_product(detail, "shakemap", preferred_source="atlas")
    assert picked["source"] == "us2"


def test_resolve_product_returns_none_when_absent():
    detail = {"properties": {"products": {}}}
    assert usgs_products.resolve_product(detail, "shakemap", preferred_source="atlas") is None


# ---------------------------------------------------------------------------
# fetch_usgs_event_products
# ---------------------------------------------------------------------------


def test_fetch_full_event_with_both_products():
    detail_text = _detail(shakemap=[SHAKEMAP_ENTRY], dyfi=[DYFI_ENTRY])
    routes = {
        usgs_products.DETAIL_URL: detail_text,
        "https://example.com/grid.xml": "<grid/>",
        "https://example.com/stationlist.json": '{"type": "FeatureCollection", "features": []}',
        "https://example.com/dyfi_geo_10km.geojson": '{"type": "FeatureCollection", "features": []}',
    }
    fetch, calls = _fake_fetch(routes)

    result = usgs_products.fetch_usgs_event_products("us_test_1", fetch_text=fetch)

    assert result.shakemap_available is True
    assert result.shakemap_product_id == "urn:shakemap:atlas:1"
    assert result.grid_xml_text == "<grid/>"
    assert result.stationlist_text is not None
    assert result.dyfi_available is True
    assert result.dyfi_product_id == "urn:dyfi:us:1"
    assert result.dyfi_geo_10km_text is not None
    assert result.rupture_available is False  # SHAKEMAP_ENTRY carries no rupture.json content
    assert result.rupture_json_text is None

    # First call is always the detail fetch, with the eventid param.
    assert calls[0][0] == usgs_products.DETAIL_URL
    assert calls[0][1] == {"eventid": "us_test_1", "format": "geojson"}


def test_fetch_event_with_rupture_model_available():
    detail_text = _detail(shakemap=[SHAKEMAP_ENTRY_WITH_RUPTURE])
    routes = {
        usgs_products.DETAIL_URL: detail_text,
        "https://example.com/grid.xml": "<grid/>",
        "https://example.com/stationlist.json": '{"type": "FeatureCollection", "features": []}',
        "https://example.com/rupture.json": '{"metadata": {}, "features": [], "type": "FeatureCollection"}',
    }
    fetch, _ = _fake_fetch(routes)

    result = usgs_products.fetch_usgs_event_products("us_rupture", fetch_text=fetch)

    assert result.rupture_available is True
    assert result.rupture_json_text is not None


def test_fetch_event_with_shakemap_but_no_rupture_content():
    detail_text = _detail(shakemap=[SHAKEMAP_ENTRY])
    routes = {
        usgs_products.DETAIL_URL: detail_text,
        "https://example.com/grid.xml": "<grid/>",
        "https://example.com/stationlist.json": '{"type": "FeatureCollection", "features": []}',
    }
    fetch, _ = _fake_fetch(routes)

    result = usgs_products.fetch_usgs_event_products("us_no_rupture", fetch_text=fetch)

    assert result.rupture_available is False
    assert result.rupture_json_text is None


def test_fetch_event_with_no_shakemap_or_dyfi_product():
    detail_text = _detail()
    fetch, _ = _fake_fetch({usgs_products.DETAIL_URL: detail_text})

    result = usgs_products.fetch_usgs_event_products("us_no_products", fetch_text=fetch)

    assert result.shakemap_available is False
    assert result.grid_xml_text is None
    assert result.dyfi_available is False
    assert result.dyfi_geo_10km_text is None


def test_fetch_event_with_shakemap_but_no_stationlist_content():
    entry = {**SHAKEMAP_ENTRY, "contents": {"download/grid.xml": {"url": "https://example.com/grid.xml"}}}
    detail_text = _detail(shakemap=[entry])
    routes = {usgs_products.DETAIL_URL: detail_text, "https://example.com/grid.xml": "<grid/>"}
    fetch, _ = _fake_fetch(routes)

    result = usgs_products.fetch_usgs_event_products("us_no_stations", fetch_text=fetch)

    assert result.shakemap_available is True
    assert result.stationlist_text is None


def test_fetch_event_with_dyfi_but_no_shakemap():
    detail_text = _detail(dyfi=[DYFI_ENTRY])
    routes = {
        usgs_products.DETAIL_URL: detail_text,
        "https://example.com/dyfi_geo_10km.geojson": '{"type": "FeatureCollection", "features": []}',
    }
    fetch, _ = _fake_fetch(routes)

    result = usgs_products.fetch_usgs_event_products("us_dyfi_only", fetch_text=fetch)

    assert result.shakemap_available is False
    assert result.dyfi_available is True


# ---------------------------------------------------------------------------
# no_usgs_products — the zero-network default
# ---------------------------------------------------------------------------


def test_no_usgs_products_makes_zero_fetch_calls():
    result = usgs_products.no_usgs_products("us_offline")
    assert result.event_id == "us_offline"
    assert result.shakemap_available is False
    assert result.dyfi_available is False
    assert result.grid_xml_text is None
    assert result.stationlist_text is None
    assert result.dyfi_geo_10km_text is None
    assert result.rupture_available is False
    assert result.rupture_json_text is None
