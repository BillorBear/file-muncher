#!/bin/bash
set -euo pipefail

script_path="${BASH_SOURCE[0]}"
while [ -L "$script_path" ]; do
  script_dir="$(cd -P "$(dirname "$script_path")" && pwd)"
  link_target="$(readlink "$script_path")"
  case "$link_target" in
    /*) script_path="$link_target" ;;
    *) script_path="$script_dir/$link_target" ;;
  esac
done
project_dir="$(cd -P "$(dirname "$script_path")/.." && pwd)"
cd "$project_dir"

if ! command -v npm >/dev/null 2>&1; then
  nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$nvm_script" ]; then
    set +u
    . "$nvm_script"
    set -u
  fi
fi
if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Node.js / npm was not found. Install Node.js 24, then run this launcher again.' >&2
  exit 1
fi
if [ ! -x node_modules/.bin/electron ]; then
  printf '%s\n' 'Dependencies are missing. Run npm ci in the repository, then try again.' >&2
  exit 1
fi

export FILE_MUNCHER_USER_DATA="$project_dir/.local-data/design-refresh"
mkdir -p "$FILE_MUNCHER_USER_DATA"
printf '%s\n' 'Starting File Muncher design preview with a separate local profile.'
exec npm start
