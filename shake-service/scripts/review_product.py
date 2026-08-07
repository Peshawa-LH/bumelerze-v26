#!/usr/bin/env python3
"""review_product — CLI: flip one exported product VERSION's
`review_status` to `"reviewed"` (D21 v1 review channel: "Peshawa flips the
flag via a simple review channel (script/dashboard first, admin UI
later)"). Peshawa runs this by hand against a product he has actually
reviewed; the CLI itself does zero science — it only records provenance.

Writes:
  1. The version's `info.json` on disk (`shake_service.review.mark_reviewed`
     — atomic, idempotent).
  2. (Optional, `--state-path`) The worker's `WorkerState.reviews` audit
     index for that event/version, so a caller inspecting state alone can
     see review history without re-reading every version's `info.json`.

Idempotent by default (a replayed/repeated call against an
already-reviewed product is a no-op, never silently overwrites the first
reviewer's name/timestamp) — pass `--allow-re-review` to explicitly
override.

Usage:
    ./.venv/bin/python scripts/review_product.py \\
        --products-root products --event-id us2000bmcg --version 1 \\
        --reviewed-by peshawa
    ./.venv/bin/python scripts/review_product.py \\
        --products-root products --event-id us2000bmcg --version 1 \\
        --reviewed-by peshawa --state-path worker_state.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # allow running as a plain script

from shake_service import review  # noqa: E402
from shake_service.worker.state import WorkerState  # noqa: E402


def review_product(
    *,
    products_root: str | Path,
    event_id: str,
    version: int,
    reviewed_by: str,
    state_path: str | Path | None = None,
    allow_re_review: bool = False,
) -> dict:
    """The full CLI action as one testable function (`main` is just an
    argparse shim around this)."""
    info_path = review.info_json_path(products_root, event_id, version)
    updated = review.mark_reviewed(info_path, reviewed_by=reviewed_by, allow_re_review=allow_re_review)

    if state_path is not None:
        state_path = Path(state_path)
        ws = WorkerState.load(state_path)
        known = ws.get_event(event_id)
        if known is not None:
            known.reviews[str(version)] = {
                "review_status": updated["review_status"],
                "reviewed_by": updated["reviewed_by"],
                "reviewed_at": updated["reviewed_at"],
            }
            ws.save(state_path)

    return {
        "event_id": event_id,
        "version": version,
        "review_status": updated["review_status"],
        "reviewed_by": updated["reviewed_by"],
        "reviewed_at": updated["reviewed_at"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--products-root", required=True)
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--version", required=True, type=int)
    parser.add_argument("--reviewed-by", required=True)
    parser.add_argument(
        "--state-path", default=None,
        help="optional — also records this review in WorkerState.reviews for the event",
    )
    parser.add_argument(
        "--allow-re-review", action="store_true",
        help="explicitly overwrite an already-reviewed product's reviewer/timestamp",
    )
    args = parser.parse_args()

    result = review_product(
        products_root=args.products_root, event_id=args.event_id, version=args.version,
        reviewed_by=args.reviewed_by, state_path=args.state_path, allow_re_review=args.allow_re_review,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
