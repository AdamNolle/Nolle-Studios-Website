#!/bin/sh
# Publish the static site to GitHub Pages (the gh-pages branch).
#
#   npm run publish:pages
#
# Builds from the current checkout with `npm run build:static`, replaces the
# whole of gh-pages with dist/ (so withdrawn files do not linger), and
# pushes. The branch is checked out in a temporary worktree outside the
# repository, so main and the working tree are never touched. Run it from a
# clean main that is already pushed; the commit names the main revision.
set -eu

REPO=$(git rev-parse --show-toplevel)
WORKTREE=$(mktemp -d "${TMPDIR:-/tmp}/nolle-gh-pages.XXXXXX")
cleanup() { git -C "$REPO" worktree remove --force "$WORKTREE" 2>/dev/null || true; git -C "$REPO" worktree prune; }
trap cleanup EXIT

cd "$REPO"
if [ -n "$(git status --porcelain)" ]; then echo "Commit or stash your changes first." >&2; exit 1; fi

# iCloud Drive leaves conflict copies ("photo 2.jpg") that Vite would publish.
find public src -type f \( -name '* [0-9].*' -o -name '* [0-9]' \) -exec rm -f {} +

rm -rf dist
npm run build:static >/dev/null
test -f dist/CNAME && test -f dist/index.html && test -f dist/404.html

SHA=$(git rev-parse --short HEAD)
git fetch -q origin gh-pages
rm -rf "$WORKTREE"
git worktree add -q --detach "$WORKTREE" origin/gh-pages
cd "$WORKTREE"
git rm -rq .
rsync -a --exclude='* [0-9].*' --exclude='* [0-9]' "$REPO/dist/" ./
git add -A
if git diff --cached --quiet; then echo "gh-pages already matches main $SHA."; exit 0; fi
git commit -q -m "Publish main $SHA"
git push -q origin HEAD:gh-pages
echo "Published main $SHA to gh-pages ($(git rev-parse --short HEAD)). GitHub Pages deploys in about a minute."
