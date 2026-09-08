#!/usr/bin/env bash
# The system node is too old for Next.js; pin this project to the nvm-installed Node 20
# and put it first on PATH so Turbopack's child processes inherit it too.
set -e
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20 >/dev/null
cd "$(dirname "$0")"
exec npm run "${1:-dev}"
