#!/usr/bin/env bash
set -euo pipefail
template="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
tmp="$(mktemp -d)"
tmp="$(cd "$tmp" && pwd -P)"
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export MOCK="$tmp/mock" AGENT_SKILLS_DIR="$tmp/agent-skills"
mkdir -p "$HOME" "$MOCK" "$tmp/bin" "$tmp/generated" "$AGENT_SKILLS_DIR/.agents" "$AGENT_SKILLS_DIR/skills/shipping-personal-projects"
cp -R "$template/.agents" "$tmp/generated/"
cp "$template/.agents/tests/mock-amp.sh" "$tmp/bin/amp"
chmod +x "$tmp/bin/amp"
export PATH="$tmp/bin:$PATH"
git -C "$tmp/generated" init -q
git -C "$tmp/generated" remote add origin git@github.com:lelouvincx/generated.git
git -C "$AGENT_SKILLS_DIR" init -q
for file in .agents/setup .agents/resume sync-skills.sh; do echo 'exit 99' >"$AGENT_SKILLS_DIR/$file"; done
echo '# canonical dispatcher' >"$AGENT_SKILLS_DIR/.agents/pre-setup"
echo 'canonical ship prompt' >"$AGENT_SKILLS_DIR/skills/shipping-personal-projects/ship.txt"
cat >"$MOCK/new" <<'JSON'
{"id":"p-generated","namespace":"lelouvincx","owner":{"type":"user"},"name":"keep-name","repositoryURL":"https://github.com/lelouvincx/generated","repositoryMode":"mapped","orbCommitAuthor":"other","baseBranch":"old","remoteURLs":[],"preSetupScript":"old","preCloneScript":"old","desktopResumeScript":"old","listedOnAmpStore":true,"description":"old","galleryMedia":[{"type":"image","url":"old"}],"environmentResource":"keep-size","iconURL":"keep-icon","allowVirtualExecutor":true}
JSON
echo '[]' >"$MOCK/list"
: >"$MOCK/log"
cd "$tmp/generated"
run() { bash .agents/configure-amp; }
must_fail() { if "$@" >"$tmp/failure" 2>&1; then echo 'Expected failure' >&2; exit 1; fi; }
assert_no_writes() {
  if grep -Eq '^projects (create|update)|^projects gallery-media set' "$1"; then
    echo 'Unexpected remote write' >&2; exit 1
  fi
}
# Creation persists the ID even when the first get fails, without any update.
must_fail env FAIL_GET=1 bash .agents/configure-amp
[ "$(git config --local --get agentInfrastructure.ampProjectID)" = p-generated ]
if grep -q '^projects update' "$MOCK/log"; then exit 1; fi
run
[ "$(grep -c '^projects create' "$MOCK/log")" = 1 ]
jq -e '.name=="keep-name" and .environmentResource=="keep-size" and .iconURL=="keep-icon" and .allowVirtualExecutor==true and .galleryMedia==[]' "$MOCK/state" >/dev/null
before="$(wc -l <"$MOCK/log")"
run >"$tmp/repeated"
tail -n "+$((before + 1))" "$MOCK/log" >"$tmp/repeated-log"
assert_no_writes "$tmp/repeated-log"
grep -q 'no writes' "$tmp/repeated"
# Existing exact map is found even with a different display name.
git config --local --unset agentInfrastructure.ampProjectID
run >/dev/null
[ "$(grep -c '^projects create' "$MOCK/log")" = 1 ]
# Canonical input changes require a new apply; exposed drift is repaired.
echo '# changed canonical dispatcher' >>"$AGENT_SKILLS_DIR/.agents/pre-setup"
run >/dev/null
old_receipt="$(git config --local --get agentInfrastructure.ampReceipt)"
echo '# newer' >>"$AGENT_SKILLS_DIR/.agents/pre-setup"
must_fail env BAD_READBACK=1 bash .agents/configure-amp
[ "$(git config --local --get agentInfrastructure.ampReceipt)" = "$old_receipt" ]
run >/dev/null
# Reject ambiguity, other ownership, stored-ID mismatch and wrong origins.
: >"$MOCK/log"
jq '[.[0],.[0]]' "$MOCK/list" >"$MOCK/next"; mv "$MOCK/next" "$MOCK/list"
must_fail run
jq '[.[0]]' "$MOCK/list" >"$MOCK/next"; mv "$MOCK/next" "$MOCK/list"
jq '.owner.type="workspace"' "$MOCK/state" >"$MOCK/next"; mv "$MOCK/next" "$MOCK/state"
must_fail run
jq '.owner.type="user"' "$MOCK/state" >"$MOCK/next"; mv "$MOCK/next" "$MOCK/state"
git config --local agentInfrastructure.ampProjectID another-project
must_fail run
git config --local agentInfrastructure.ampProjectID p-generated
git remote set-url origin https://github.com/another-owner/generated
must_fail run
git remote set-url origin https://github.com/lelouvincx/generated.git
# A same display name on another repo must never be selected or updated.
echo '[{"id":"other","namespace":"lelouvincx","name":"generated","repositoryURL":"https://github.com/lelouvincx/another"}]' >"$MOCK/list"
must_fail run
assert_no_writes "$MOCK/log"
echo 'PASS configure-amp: unborn generated repo, exact map, create receipt, update, readback, idempotence and safety boundaries'
