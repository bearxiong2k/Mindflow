#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gui_dir="$(cd "$script_dir/.." && pwd)"
source_svg="$gui_dir/src-tauri/icons/development/app-icon.svg"
output_dir="$gui_dir/src-tauri/icons/development"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/mindflow-development-icons.XXXXXX")"
normalized_iconset="$temporary_dir/development.iconset"
normalized_icns="$temporary_dir/icon.normalized.icns"

cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

if [[ ! -x "$gui_dir/node_modules/.bin/tauri" ]]; then
  echo "error: GUI dependencies are missing; run 'npm install' in $gui_dir" >&2
  exit 1
fi
if ! command -v iconutil >/dev/null 2>&1; then
  echo "error: iconutil is required to create the macOS development icon" >&2
  exit 1
fi

"$gui_dir/node_modules/.bin/tauri" icon "$source_svg" --output "$temporary_dir"

# Tauri emits identical icon images in nondeterministic ICNS entry order.
# Repacking through macOS iconutil keeps regenerations byte-for-byte stable.
iconutil --convert iconset --output "$normalized_iconset" "$temporary_dir/icon.icns"
iconutil --convert icns --output "$normalized_icns" "$normalized_iconset"

for icon_name in \
  32x32.png \
  128x128.png \
  128x128@2x.png \
  icon.ico; do
  cp "$temporary_dir/$icon_name" "$output_dir/$icon_name"
done
cp "$normalized_icns" "$output_dir/icon.icns"

echo "Regenerated the Mind Dev icon set from $source_svg"
