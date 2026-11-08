#!/usr/bin/env bash
set -euo pipefail
template="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
tmp="$(mktemp -d)"
# macOS /var is a symlink; bootstrap deliberately rejects symlink components.
tmp="$(cd "$tmp" && pwd -P)"
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" AMP_CONFIG_DIR="$tmp/home/.config/amp"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
assert_absent() { if grep -q "$1" "$2"; then echo "Unexpected match: $1" >&2; exit 1; fi; }
mkdir -p "$HOME" "$tmp/generated" "$tmp/upstream/.agents"
cp -R "$template/.agents" "$tmp/generated/"
cp "$template/.gitignore" "$tmp/generated/"
git -C "$tmp/generated" init -q
git -C "$tmp/upstream" init -q
export TRACE="$tmp/trace"
: >"$TRACE"
# Stand-in canonical hooks own refresh and projection. No consumer refresh.
cat >"$tmp/upstream/.agents/resume" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
echo baseline >>"$TRACE"
if [ "${FAIL_BASELINE:-0}" = 1 ]; then exit 17; fi
if [ -z "$(git -C "$AGENT_SKILLS_DIR" status --porcelain --untracked-files=all)" ]; then
  echo pull >>"$TRACE"
  git -C "$AGENT_SKILLS_DIR" pull --ff-only
fi
bash "$AGENT_SKILLS_DIR/sync-skills.sh"
HOOK
cat >"$tmp/upstream/.agents/setup" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
echo setup-baseline >>"$TRACE"
exec bash "$AGENT_SKILLS_DIR/.agents/resume"
HOOK
cat >"$tmp/upstream/sync-skills.sh" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$AMP_CONFIG_DIR"
cp "$AGENT_SKILLS_DIR/baseline" "$AMP_CONFIG_DIR/managed"
HOOK
echo v1 >"$tmp/upstream/baseline"
git -C "$tmp/upstream" add .
git -C "$tmp/upstream" commit -qm fixture
git clone -q "$tmp/upstream" "$tmp/agent-skills"
export AGENT_SKILLS_DIR="$tmp/agent-skills"
cat >"$tmp/generated/.agents/project" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
echo "common:$1" >>"$TRACE"
[ "${FAIL_PROJECT:-0}" != 1 ] || exit 18
if [ "${REMOVE_OVERRIDE:-0}" = 1 ]; then
  rm -f "$AMP_CONFIG_DIR/project-only"
else
  echo override >"$AMP_CONFIG_DIR/managed"
  echo custom >"$AMP_CONFIG_DIR/project-only"
fi
case "$1" in setup|resume) echo "app:$1" >>"$TRACE" ;; sync) ;; *) exit 2 ;; esac
HOOK
bash "$tmp/generated/.agents/setup" >/dev/null
grep -q '^setup-baseline$' "$TRACE"
grep -q '^app:setup$' "$TRACE"
[ "$(cat "$AMP_CONFIG_DIR/managed")" = override ]
echo unrelated >"$AMP_CONFIG_DIR/unrelated"
: >"$TRACE"
bash "$tmp/generated/.agents/sync" >/dev/null
bash "$tmp/generated/.agents/sync" >/dev/null
[ "$(grep -c '^pull$' "$TRACE")" = 2 ]
assert_absent '^app:' "$TRACE"
[ "$(cat "$AMP_CONFIG_DIR/unrelated")" = unrelated ]
echo v2 >"$tmp/upstream/baseline"
git -C "$tmp/upstream" commit -qam newer
REMOVE_OVERRIDE=1 bash "$tmp/generated/.agents/sync" >/dev/null
REMOVE_OVERRIDE=1 bash "$tmp/generated/.agents/sync" >/dev/null
[ "$(cat "$AMP_CONFIG_DIR/managed")" = v2 ]
[ ! -e "$AMP_CONFIG_DIR/project-only" ]
[ "$(cat "$AMP_CONFIG_DIR/unrelated")" = unrelated ]
echo dirty >"$AGENT_SKILLS_DIR/untracked"
: >"$TRACE"
bash "$tmp/generated/.agents/resume" >/dev/null
assert_absent '^pull$' "$TRACE"
grep -q '^app:resume$' "$TRACE"
[ "$(cat "$AGENT_SKILLS_DIR/untracked")" = dirty ]
rm "$AGENT_SKILLS_DIR/untracked"
for kind in tracked staged; do
  echo "$kind" >>"$AGENT_SKILLS_DIR/baseline"
  if [ "$kind" = staged ]; then git -C "$AGENT_SKILLS_DIR" add baseline; fi
  : >"$TRACE"
  bash "$tmp/generated/.agents/sync" >/dev/null
  assert_absent '^pull$' "$TRACE"
done
: >"$TRACE"
if FAIL_BASELINE=1 bash "$tmp/generated/.agents/setup" >/dev/null 2>&1; then exit 1; fi
assert_absent '^common:' "$TRACE"
mkdir "$tmp/not-git"
ln -s "$AGENT_SKILLS_DIR" "$tmp/link"
ln -s "$tmp/missing" "$tmp/dangling"
for invalid in "$tmp/not-git" "$tmp/link" "$tmp/link/" "$tmp/dangling" "$AGENT_SKILLS_DIR/.agents"; do
  : >"$TRACE"
  if AGENT_SKILLS_DIR="$invalid" bash "$tmp/generated/.agents/sync" >/dev/null 2>&1; then exit 1; fi
  [ ! -s "$TRACE" ]
done
AGENT_SKILLS_DIR="$tmp/cloned" AGENT_SKILLS_REPO="$tmp/upstream" bash "$tmp/generated/.agents/sync" >/dev/null
[ -d "$tmp/cloned/.git" ]
git -C "$tmp/cloned" checkout -q --detach
: >"$TRACE"
if AGENT_SKILLS_DIR="$tmp/cloned" bash "$tmp/generated/.agents/sync" >/dev/null 2>&1; then exit 1; fi
assert_absent '^common:' "$TRACE"
if FAIL_PROJECT=1 bash "$tmp/generated/.agents/sync" >/dev/null 2>&1; then exit 1; fi
# Exercise sibling selection without writing fixed Amp checkout paths.
if [ ! -e /home/user/workspace/repos/agent-skills ] && [ ! -L /home/user/workspace/repos/agent-skills ]; then
  env -u AGENT_SKILLS_DIR bash "$tmp/generated/.agents/sync" >/dev/null
fi
for ignored in .amp/in/evidence .env credentials.json; do
  git -C "$tmp/generated" check-ignore -q "$ignored"
done
echo 'PASS lifecycle: generated copy, ordering, refresh, dirty preservation, overrides, invalid source and clone'
