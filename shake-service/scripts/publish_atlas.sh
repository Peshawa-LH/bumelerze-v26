#!/usr/bin/env bash
# Publish the staged Atlas tree to the public Bumelerze Atlas repository.
#
# The worker writes products into a local staging directory
# (BUMELERZE_ATLAS_PUBLISH_ROOT, default `atlas-publish/` beside this
# package). This script copies that tree into a clone of the public Atlas
# repository and pushes it, which triggers that repository's own Pages
# workflow and puts the products on the CDN a minute or so later.
#
# Products are immutable per version, so this only ever adds files. An
# existing version is never rewritten; a corrected computation publishes a
# new version instead, and the superseded one stays in git history. That is
# what makes the published record auditable after a science correction.
#
# Usage:
#   ./scripts/publish_atlas.sh                 # publish, then push
#   ./scripts/publish_atlas.sh --dry-run       # show what would change
#
# Requires: git, and push access to the Atlas repository.

set -euo pipefail

ATLAS_REMOTE="${BUMELERZE_ATLAS_REMOTE:-https://github.com/Peshawa-LH/bumelerze-atlas.git}"
STAGING="${BUMELERZE_ATLAS_PUBLISH_ROOT:-$(cd "$(dirname "$0")/.." && pwd)/atlas-publish}"
WORKDIR="${BUMELERZE_ATLAS_CLONE:-${TMPDIR:-/tmp}/bumelerze-atlas-publish}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

if [ ! -d "$STAGING/events" ]; then
  echo "nothing to publish: no staged events at $STAGING" >&2
  exit 1
fi

if [ -d "$WORKDIR/.git" ]; then
  git -C "$WORKDIR" fetch --quiet origin main
  git -C "$WORKDIR" reset --quiet --hard origin/main
else
  rm -rf "$WORKDIR"
  git clone --quiet "$ATLAS_REMOTE" "$WORKDIR"
fi

# Additive copy. Never delete: a version already published stays published.
cp -R "$STAGING/events/." "$WORKDIR/events/"
[ -f "$STAGING/index.json" ] && cp "$STAGING/index.json" "$WORKDIR/index.json"

cd "$WORKDIR"
if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "already published: nothing changed"
  exit 0
fi

EVENTS=$(find events -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
VERSIONS=$(find events -mindepth 2 -maxdepth 2 -type d | wc -l | tr -d ' ')

if [ "$DRY_RUN" = "1" ]; then
  echo "would publish: $EVENTS events, $VERSIONS product versions"
  git status --short | head -30
  exit 0
fi

git add -A
git -c user.name="Bumelerze" -c user.email="dev@bumelerze.com" \
  commit -q -m "Publish products: $EVENTS events, $VERSIONS versions"
git push -q origin main
echo "published $EVENTS events ($VERSIONS versions) to $ATLAS_REMOTE"
