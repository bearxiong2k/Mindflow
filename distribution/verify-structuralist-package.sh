#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mindflow_root="$(cd "$script_dir/.." && pwd)"
mindflow_command="${MINDFLOW_BIN:-$mindflow_root/bin/mindflow}"

if [[ "$mindflow_command" == */* ]]; then
  [[ -x "$mindflow_command" ]] || {
    echo "error: Mindflow executable is unavailable: $mindflow_command" >&2
    exit 1
  }
else
  command -v "$mindflow_command" >/dev/null 2>&1 || {
    echo "error: set MINDFLOW_BIN or install mindflow" >&2
    exit 1
  }
fi

ruby "$script_dir/validate-structuralist-skill.rb"
"$script_dir/check-structuralist-recipe.sh" "$mindflow_command"

echo "Structuralist package checks passed"
