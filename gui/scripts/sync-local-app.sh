#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gui_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$gui_dir/.." && pwd)"
cli_path="$repo_root/target/release/mindflow"
observer_path="$repo_root/target/release/mindflow-observe"
release_dir="$gui_dir/src-tauri/target/release/bundle/macos"
# shellcheck source=local-app-identity.sh
source "$script_dir/local-app-identity.sh"
bundle_path="$local_app_bundle_path"
bundle_info_path="$local_app_info_path"
app_executable_path="$local_app_executable_path"
obsolete_bundle_path="$local_app_obsolete_bundle_path"
sync_state_path="$release_dir/.mindflow-toolchain-digest"
lock_root="$repo_root/target"
lock_path="$lock_root/mindflow-local-toolchain-sync.lock"
check_only=false
force_launch=false
quiet=false

for argument in "$@"; do
  case "$argument" in
    --check)
      check_only=true
      ;;
    --launch)
      force_launch=true
      ;;
    --quiet)
      quiet=true
      ;;
    *)
      echo "error: unsupported argument '$argument'" >&2
      echo "usage: $0 [--check] [--launch] [--quiet]" >&2
      exit 2
      ;;
  esac
done

if $check_only && $force_launch; then
  echo "error: --check and --launch cannot be used together" >&2
  exit 2
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: local Mindflow toolchain synchronization currently requires macOS" >&2
  exit 1
fi

source_inputs=(
  "$repo_root/Cargo.toml"
  "$repo_root/Cargo.lock"
  "$repo_root/rust-toolchain.toml"
  "$repo_root/src"
  "$repo_root/bin"
  "$gui_dir/package.json"
  "$gui_dir/package-lock.json"
  "$gui_dir/index.html"
  "$gui_dir/tsconfig.json"
  "$gui_dir/vite.config.ts"
  "$gui_dir/src"
  "$gui_dir/scripts"
  "$gui_dir/src-tauri/Cargo.toml"
  "$gui_dir/src-tauri/Cargo.lock"
  "$gui_dir/src-tauri/build.rs"
  "$gui_dir/src-tauri/tauri.conf.json"
  "$gui_dir/src-tauri/tauri.stable.conf.json"
  "$gui_dir/src-tauri/src"
  "$gui_dir/src-tauri/icons"
)

if [[ -d "$repo_root/tests" ]]; then
  source_inputs+=("$repo_root/tests")
fi

toolchain_error() {
  echo "error: $1" >&2
  echo "checkout: $repo_root" >&2
  echo "synchronize: cd \"$gui_dir\" && npm run sync:local" >&2
  return 1
}

read_tauri_config_value() {
  /usr/bin/plutil -extract "$1" raw -o - "$local_app_tauri_config_path"
}

read_bundle_info_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$bundle_info_path"
}

read_declared_release_version() {
  awk -F '"' '/^version = "/ { print $2; exit }' "$repo_root/Cargo.toml"
}

check_declared_app_identity() {
  local actual_product_name actual_identifier actual_window_title actual_icon_path
  local release_version declared_version overlay_version
  release_version="$(read_declared_release_version)"
  if [[ -z "$release_version" ]]; then
    toolchain_error "Core package has no declared release version"
    return 1
  fi
  for declared_version in \
    "$(awk -F '"' '/^version = "/ { print $2; exit }' "$gui_dir/src-tauri/Cargo.toml")" \
    "$(/usr/bin/plutil -extract version raw -o - "$gui_dir/package.json")" \
    "$(/usr/bin/plutil -extract version raw -o - "$gui_dir/src-tauri/tauri.conf.json")"; do
    if [[ "$declared_version" != "$release_version" ]]; then
      toolchain_error "app/CLI package versions disagree; expected '$release_version', found '$declared_version'"
      return 1
    fi
  done
  if ! overlay_version="$(read_tauri_config_value version 2>/dev/null)"; then
    overlay_version=""
  fi
  if [[ -n "$overlay_version" && "$overlay_version" != "$release_version" ]]; then
    toolchain_error "selected Tauri overlay changes the release version to '$overlay_version'"
    return 1
  fi

  if ! actual_product_name="$(read_tauri_config_value productName 2>/dev/null)"; then
    toolchain_error "Tauri configuration has no readable productName: $local_app_tauri_config_path"
    return 1
  fi
  if [[ "$actual_product_name" != "$local_app_name" ]]; then
    toolchain_error "Tauri productName must be '$local_app_name', found '$actual_product_name'"
    return 1
  fi
  if ! actual_identifier="$(read_tauri_config_value identifier 2>/dev/null)"; then
    toolchain_error "Tauri configuration has no readable identifier: $local_app_tauri_config_path"
    return 1
  fi
  if [[ "$actual_identifier" != "$local_app_identifier" ]]; then
    toolchain_error "Tauri identifier must be '$local_app_identifier', found '$actual_identifier'"
    return 1
  fi
  if ! actual_window_title="$(read_tauri_config_value app.windows.0.title 2>/dev/null)"; then
    toolchain_error "Tauri configuration has no readable default window title: $local_app_tauri_config_path"
    return 1
  fi
  if [[ "$actual_window_title" != "$local_app_name" ]]; then
    toolchain_error "Tauri default window title must be '$local_app_name', found '$actual_window_title'"
    return 1
  fi
  if ! actual_icon_path="$(read_tauri_config_value bundle.icon.3 2>/dev/null)"; then
    toolchain_error "Tauri configuration has no readable macOS icon: $local_app_tauri_config_path"
    return 1
  fi
  if [[ "$gui_dir/src-tauri/$actual_icon_path" != "$local_app_icon_source_path" ]]; then
    toolchain_error "Tauri macOS icon does not match the selected '$local_app_variant' identity"
    return 1
  fi
  if [[ ! -f "$local_app_icon_source_path" ]]; then
    toolchain_error "selected app icon is missing: $local_app_icon_source_path"
    return 1
  fi
}

check_packaged_app_identity() {
  local actual_bundle_name actual_display_name actual_identifier actual_executable actual_version

  if [[ ! -f "$bundle_info_path" ]]; then
    toolchain_error "packaged local app has no Info.plist: $bundle_info_path"
    return 1
  fi
  if ! actual_bundle_name="$(read_bundle_info_value CFBundleName 2>/dev/null)"; then
    toolchain_error "packaged local app has no readable CFBundleName"
    return 1
  fi
  if [[ "$actual_bundle_name" != "$local_app_name" ]]; then
    toolchain_error "packaged CFBundleName must be '$local_app_name', found '$actual_bundle_name'"
    return 1
  fi
  if ! actual_display_name="$(read_bundle_info_value CFBundleDisplayName 2>/dev/null)"; then
    toolchain_error "packaged local app has no readable CFBundleDisplayName"
    return 1
  fi
  if [[ "$actual_display_name" != "$local_app_name" ]]; then
    toolchain_error "packaged CFBundleDisplayName must be '$local_app_name', found '$actual_display_name'"
    return 1
  fi
  if ! actual_identifier="$(read_bundle_info_value CFBundleIdentifier 2>/dev/null)"; then
    toolchain_error "packaged local app has no readable CFBundleIdentifier"
    return 1
  fi
  if [[ "$actual_identifier" != "$local_app_identifier" ]]; then
    toolchain_error "packaged CFBundleIdentifier must be '$local_app_identifier', found '$actual_identifier'"
    return 1
  fi
  if ! actual_executable="$(read_bundle_info_value CFBundleExecutable 2>/dev/null)"; then
    toolchain_error "packaged local app has no readable CFBundleExecutable"
    return 1
  fi
  if [[ "$actual_executable" != "$local_app_executable_name" ]]; then
    toolchain_error "packaged CFBundleExecutable must be '$local_app_executable_name', found '$actual_executable'"
    return 1
  fi
  if ! actual_version="$(read_bundle_info_value CFBundleShortVersionString 2>/dev/null)"; then
    toolchain_error "packaged local app has no readable release version"
    return 1
  fi
  if [[ "$actual_version" != "$(read_declared_release_version)" ]]; then
    toolchain_error "packaged local app release version '$actual_version' does not match this checkout"
    return 1
  fi
  if [[ ! -f "$local_app_bundle_icon_path" ]]; then
    toolchain_error "packaged local app has no icon.icns resource"
    return 1
  fi
  if ! cmp -s "$local_app_icon_source_path" "$local_app_bundle_icon_path"; then
    toolchain_error "packaged app icon does not match the selected '$local_app_variant' identity"
    return 1
  fi
}

check_obsolete_bundle_absent() {
  if [[ -e "$obsolete_bundle_path" || -L "$obsolete_bundle_path" ]]; then
    toolchain_error "unselected same-checkout bundle makes target selection ambiguous: $obsolete_bundle_path"
    return 1
  fi
}

remove_obsolete_bundle() {
  if [[ ! -e "$obsolete_bundle_path" && ! -L "$obsolete_bundle_path" ]]; then
    return 0
  fi
  if [[ "$obsolete_bundle_path" != "$release_dir/Mindflow.app" &&
    "$obsolete_bundle_path" != "$release_dir/Mind Dev.app" ]]; then
    toolchain_error "refusing to remove an unexpected unselected-bundle path: $obsolete_bundle_path"
    return 1
  fi
  echo "Removing unselected same-checkout bundle: $obsolete_bundle_path"
  rm -rf -- "$obsolete_bundle_path"
}

calculate_source_digest() {
  local input source_file current_variant
  local source_files=()

  for input in "${source_inputs[@]}"; do
    if [[ ! -d "$input" && ! -f "$input" ]]; then
      toolchain_error "toolchain source input is missing: $input"
      return 1
    fi
  done

  while IFS= read -r -d '' source_file; do
    source_files+=("$source_file")
  done < <(
    {
      for input in "${source_inputs[@]}"; do
        if [[ -d "$input" ]]; then
          find "$input" -type f -print0
        else
          printf '%s\0' "$input"
        fi
      done
    } | LC_ALL=C sort -z
  )

  current_variant="$(mindflow_read_local_app_variant)"
  {
    shasum -a 256 "${source_files[@]}"
    printf 'local-app-variant %s\n' "$current_variant"
  } | shasum -a 256 | awk '{print $1}'
}

calculate_file_digest() {
  shasum -a 256 "$1" | awk '{print $1}'
}

calculate_bundle_digest() {
  local bundle_file
  local bundle_files=()

  while IFS= read -r -d '' bundle_file; do
    bundle_files+=("$bundle_file")
  done < <(find "$bundle_path" -type f -print0 | LC_ALL=C sort -z)

  shasum -a 256 "${bundle_files[@]}" |
    shasum -a 256 |
    awk '{print $1}'
}

read_recorded_value() {
  local key="$1"
  awk -v key="$key" '$1 == key { print $2; exit }' "$sync_state_path"
}

read_recorded_remainder() {
  local key="$1"
  awk -v key="$key" '$1 == key { $1 = ""; sub(/^[[:space:]]+/, ""); print; exit }' \
    "$sync_state_path"
}

check_synchronized() {
  local allow_active_sync="${1:-false}"

  if ! $allow_active_sync && [[ -d "$lock_path" ]]; then
    toolchain_error "local toolchain synchronization is currently running"
    return 1
  fi
  check_declared_app_identity
  check_obsolete_bundle_absent
  if [[ ! -x "$cli_path" ]]; then
    toolchain_error "synchronized release CLI is missing: $cli_path"
    return 1
  fi
  if [[ ! -x "$observer_path" ]]; then
    toolchain_error "synchronized release observer is missing: $observer_path"
    return 1
  fi
  for launcher_path in \
    "$repo_root/bin/mindflow" \
    "$repo_root/bin/mindflow-observe" \
    "$repo_root/bin/mindflow-app" \
    "$script_dir/local-app-identity.sh" \
    "$script_dir/sync-local-app.sh"; do
    if [[ ! -x "$launcher_path" ]]; then
      toolchain_error "tracked local toolchain entry point is not executable: $launcher_path"
      return 1
    fi
  done
  if [[ ! -x "$app_executable_path" ]]; then
    toolchain_error "synchronized packaged app is missing: $bundle_path"
    return 1
  fi
  check_packaged_app_identity
  if [[ ! -f "$sync_state_path" ]]; then
    toolchain_error "local toolchain has no synchronization record"
    return 1
  fi
  if [[ "$(read_recorded_value version-info)" != "1" ]] ||
    [[ "$(read_recorded_value release)" != "$(read_declared_release_version)" ]]; then
    toolchain_error "synchronization record has unknown or mismatched release identity"
    return 1
  fi

  local recorded_app_variant recorded_app_identifier recorded_app_executable
  recorded_app_variant="$(read_recorded_value app-variant)"
  recorded_app_identifier="$(read_recorded_value app-identifier)"
  recorded_app_executable="$(read_recorded_remainder app-executable)"
  if [[ "$recorded_app_variant" != "$local_app_variant" ]] ||
    [[ "$recorded_app_identifier" != "$local_app_identifier" ]] ||
    [[ "$recorded_app_executable" != "$local_app_relative_executable_path" ]]; then
    toolchain_error "synchronization record does not select this worktree's local app identity"
    return 1
  fi

  local current_source_digest recorded_source_digest
  current_source_digest="$(calculate_source_digest)"
  recorded_source_digest="$(read_recorded_value source-digest)"
  if [[ -z "$recorded_source_digest" || "$recorded_source_digest" != "$current_source_digest" ]]; then
    toolchain_error "local toolchain is stale"
    return 1
  fi

  local current_cli_digest recorded_cli_digest
  current_cli_digest="$(calculate_file_digest "$cli_path")"
  recorded_cli_digest="$(read_recorded_value cli-digest)"
  if [[ -z "$recorded_cli_digest" || "$recorded_cli_digest" != "$current_cli_digest" ]]; then
    toolchain_error "synchronized release CLI does not match its synchronization record"
    return 1
  fi

  local current_observer_digest recorded_observer_digest
  current_observer_digest="$(calculate_file_digest "$observer_path")"
  recorded_observer_digest="$(read_recorded_value observer-digest)"
  if [[ -z "$recorded_observer_digest" || "$recorded_observer_digest" != "$current_observer_digest" ]]; then
    toolchain_error "synchronized release observer does not match its synchronization record"
    return 1
  fi

  local current_app_digest recorded_app_digest
  current_app_digest="$(calculate_bundle_digest)"
  recorded_app_digest="$(read_recorded_value app-digest)"
  if [[ -z "$recorded_app_digest" || "$recorded_app_digest" != "$current_app_digest" ]]; then
    toolchain_error "packaged app does not match its synchronization record"
    return 1
  fi

  if ! $quiet; then
    echo "Mindflow CLI, runtime observer, and $local_app_name.app are synchronized with this checkout."
  fi
}

if $check_only; then
  check_synchronized false
  exit 0
fi

mkdir -p "$lock_root"
if ! mkdir "$lock_path" 2>/dev/null; then
  toolchain_error "another local toolchain synchronization is already running"
  exit 1
fi
trap 'rmdir "$lock_path" 2>/dev/null || true' EXIT

if [[ ! -x "$gui_dir/node_modules/.bin/tauri" ]]; then
  echo "error: GUI dependencies are missing; run 'npm install' in $gui_dir" >&2
  exit 1
fi

check_declared_app_identity
source_digest_before="$(calculate_source_digest)"
export MINDFLOW_BUILD_SOURCE_DIGEST="$source_digest_before"
export MINDFLOW_BUILD_REVISION="$(git -C "$repo_root" rev-parse --verify HEAD)"
if ! git -C "$repo_root" diff --quiet --ignore-submodules -- ||
  ! git -C "$repo_root" diff --cached --quiet --ignore-submodules -- ||
  [[ -n "$(git -C "$repo_root" ls-files --others --exclude-standard)" ]]; then
  MINDFLOW_BUILD_REVISION="${MINDFLOW_BUILD_REVISION}-dirty"
fi
export MINDFLOW_BUILD_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

echo "Validating the shared core and CLI..."
(cd "$repo_root" && cargo test --all-targets)

echo "Validating the desktop boundary..."
(cd "$repo_root" && cargo test --manifest-path gui/src-tauri/Cargo.toml)

echo "Validating the frontend..."
(cd "$gui_dir" && npm run test:frontend)

echo "Validating the local toolchain launchers..."
(cd "$gui_dir" && npm run test:toolchain)

echo "Building the release CLI and runtime observer..."
(cd "$repo_root" && cargo build --release --bin mindflow --bin mindflow-observe)

echo "Building the packaged local app..."
if ((${#local_app_tauri_build_args[@]} > 0)); then
  (cd "$gui_dir" && npm run build -- "${local_app_tauri_build_args[@]}")
else
  (cd "$gui_dir" && npm run build)
fi

if [[ ! -x "$cli_path" ]]; then
  toolchain_error "Cargo reported success but the release CLI is missing"
  exit 1
fi
if ! "$cli_path" --version >/dev/null; then
  toolchain_error "the release CLI failed its executable smoke test"
  exit 1
fi
if [[ ! -x "$observer_path" ]]; then
  toolchain_error "Cargo reported success but the release runtime observer is missing"
  exit 1
fi
if ! "$observer_path" --version >/dev/null; then
  toolchain_error "the release runtime observer failed its executable smoke test"
  exit 1
fi
if [[ ! -x "$app_executable_path" ]]; then
  toolchain_error "Tauri reported success but the packaged app is missing"
  exit 1
fi
if ! file "$app_executable_path" | grep -q 'Mach-O'; then
  toolchain_error "the packaged app executable failed its artifact smoke test"
  exit 1
fi
check_packaged_app_identity
remove_obsolete_bundle

source_digest_after="$(calculate_source_digest)"
if [[ "$source_digest_before" != "$source_digest_after" ]]; then
  toolchain_error "toolchain inputs changed during synchronization; rerun against one coherent edit set"
  exit 1
fi

cli_digest="$(calculate_file_digest "$cli_path")"
observer_digest="$(calculate_file_digest "$observer_path")"
app_digest="$(calculate_bundle_digest)"
sync_state_temp="$(mktemp "$release_dir/.mindflow-toolchain-digest.XXXXXX")"
{
  printf 'version-info 1\n'
  printf 'release %s\n' "$(read_declared_release_version)"
  printf 'source-digest %s\n' "$source_digest_after"
  printf 'cli-digest %s\n' "$cli_digest"
  printf 'observer-digest %s\n' "$observer_digest"
  printf 'app-digest %s\n' "$app_digest"
  printf 'app-variant %s\n' "$local_app_variant"
  printf 'app-identifier %s\n' "$local_app_identifier"
  printf 'app-executable %s\n' "$local_app_relative_executable_path"
  printf 'git-revision %s\n' "$MINDFLOW_BUILD_REVISION"
  printf 'built-at %s\n' "$MINDFLOW_BUILD_UTC"
} > "$sync_state_temp"
mv -f "$sync_state_temp" "$sync_state_path"

check_synchronized true

echo "Release CLI: $cli_path"
echo "Release version: $(read_declared_release_version)"
echo "Release runtime observer: $observer_path"
echo "Packaged local app: $bundle_path"
echo "Packaged app identifier: $local_app_identifier"

if $force_launch; then
  open "$bundle_path"
  echo "Opened the synchronized $local_app_name.app without selecting a project root."
fi
