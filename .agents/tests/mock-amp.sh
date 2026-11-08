#!/usr/bin/env bash
# Test-only Amp CLI boundary. Reject any unexpected command or flag.
set -euo pipefail
echo "$*" >>"$MOCK/log"
[ "$1" = projects ]; shift
read_state() { cat "$MOCK/state"; }
put() { jq "$@" "$MOCK/state" >"$MOCK/next"; mv "$MOCK/next" "$MOCK/state"; }
case "$1" in
  list)
    [ "$*" = 'list --json' ]
    cat "$MOCK/list"
    ;;
  create)
    [ "$*" = 'create lelouvincx/generated --personal --json' ]
    cp "$MOCK/new" "$MOCK/state"
    jq '[.]' "$MOCK/state" >"$MOCK/list"
    read_state
    ;;
  get)
    [ "$*" = 'get p-generated --json' ]
    [ "${FAIL_GET:-0}" != 1 ] || exit 19
    read_state
    ;;
  update)
    [ "$2" = p-generated ]; shift 2
    [ "$(git config --local --get agentInfrastructure.ampProjectID)" = p-generated ]
    [ "${FAIL_UPDATE:-0}" != 1 ] || exit 20
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --repository-url) put --arg v "$2" '.repositoryURL=$v'; shift ;;
        --repository-mode) put --arg v "$2" '.repositoryMode=$v'; shift ;;
        --remote-url)
          # Supported readback deduplicates standard SSH and HTTPS aliases.
          [ "$2" = git@github.com:lelouvincx/generated.git ]
          put '.remoteURLs=[.repositoryURL]'; shift ;;
        --commit-author) put --arg v "$2" '.orbCommitAuthor=$v'; shift ;;
        --pre-setup-script-file) put --rawfile v "$2" '.preSetupScript=$v'; shift ;;
        --pre-clone-script-file) [ ! -s "$2" ]; put '.preCloneScript=""'; shift ;;
        --desktop-resume-script-file) [ ! -s "$2" ]; put '.desktopResumeScript=""'; shift ;;
        --custom-ship-prompt-file) cmp "$2" "$AGENT_SKILLS_DIR/skills/shipping-personal-projects/ship.txt"; shift ;;
        --ship-behavior) [ "$2" = custom ]; shift ;;
        --clear-base-branch) put '.baseBranch=""' ;;
        --clear-additional-repositories) ;;
        --no-listed-on-amp-store) put '.listedOnAmpStore=false' ;;
        --description) [ -z "$2" ]; put '.description=""'; shift ;;
        --json) ;;
        *) echo "Unexpected update flag $1" >&2; exit 2 ;;
      esac
      shift
    done
    if [ "${BAD_READBACK:-0}" = 1 ]; then put '.repositoryMode="mapped"'; fi
    read_state
    ;;
  gallery-media)
    case "$2" in
      get) [ "$*" = 'gallery-media get p-generated' ]; jq '.galleryMedia' "$MOCK/state" ;;
      set) [ "$*" = 'gallery-media set p-generated []' ]; put '.galleryMedia=[]' ;;
      *) exit 2 ;;
    esac
    ;;
  *) echo "Unexpected Amp command: $*" >&2; exit 2 ;;
esac
