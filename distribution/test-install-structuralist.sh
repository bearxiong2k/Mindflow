#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/mindflow-skill-install.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
destination="$test_root/agent skills/structuralist"
bash "$script_dir/install-structuralist.sh" "$destination"
bash "$script_dir/install-structuralist.sh" --check "$destination"
if bash "$script_dir/install-structuralist.sh" "$destination" >/dev/null 2>&1; then
  echo "error: installer replaced an existing skill" >&2
  exit 1
fi
printf '\nLocal customization\n' >> "$destination/SKILL.md"
if bash "$script_dir/install-structuralist.sh" --check "$destination" >/dev/null 2>&1; then
  echo "error: modified package passed comparison" >&2
  exit 1
fi
ln -s "$destination" "$test_root/existing-link"
if bash "$script_dir/install-structuralist.sh" "$test_root/existing-link" >/dev/null 2>&1; then
  echo "error: installer replaced an existing link" >&2
  exit 1
fi
if bash "$script_dir/install-structuralist.sh" "$script_dir/../skills/structuralist/nested-install" >/dev/null 2>&1; then
  echo "error: installer accepted recursive source destination" >&2
  exit 1
fi
echo "Structuralist installation and preservation checks passed"
