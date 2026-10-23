#!/usr/bin/env bash

# This file is sourced by the local launch, synchronization, and test scripts.
# Keep the selected identity in Git's worktree-local configuration so sibling
# worktrees may package different local distributions without branch-specific
# source edits.

mindflow_identity_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mindflow_identity_gui_dir="$(cd "$mindflow_identity_script_dir/.." && pwd)"
mindflow_identity_repo_root="$(cd "$mindflow_identity_gui_dir/.." && pwd)"
mindflow_identity_release_dir="$mindflow_identity_gui_dir/src-tauri/target/release/bundle/macos"

mindflow_read_local_app_variant() {
  local configured_variant=""

  if git -C "$mindflow_identity_repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    configured_variant="$(
      git -C "$mindflow_identity_repo_root" config --worktree --get mindflow.localAppVariant \
        2>/dev/null || true
    )"
  fi

  if [[ -z "$configured_variant" ]]; then
    configured_variant="development"
  fi

  case "$configured_variant" in
    development | stable)
      printf '%s\n' "$configured_variant"
      ;;
    *)
      echo "error: unsupported worktree-local Mindflow app variant '$configured_variant'" >&2
      echo "allowed variants: development, stable" >&2
      echo "configure development: git config --worktree mindflow.localAppVariant development" >&2
      echo "configure stable: git config --worktree mindflow.localAppVariant stable" >&2
      return 1
      ;;
  esac
}

local_app_variant="$(mindflow_read_local_app_variant)" || return 1 2>/dev/null || exit 1
local_app_executable_name="mindflow-desktop"
local_app_base_tauri_config_path="$mindflow_identity_gui_dir/src-tauri/tauri.conf.json"
local_app_stable_tauri_config_path="$mindflow_identity_gui_dir/src-tauri/tauri.stable.conf.json"
local_app_tauri_build_args=()

case "$local_app_variant" in
  development)
    local_app_name="Mind Dev"
    local_app_identifier="dev.mindflow.desktop.development"
    local_app_tauri_config_path="$local_app_base_tauri_config_path"
    local_app_icon_source_path="$mindflow_identity_gui_dir/src-tauri/icons/development/icon.icns"
    local_app_obsolete_name="Mindflow"
    ;;
  stable)
    local_app_name="Mindflow"
    local_app_identifier="dev.mindflow.desktop"
    local_app_tauri_config_path="$local_app_stable_tauri_config_path"
    local_app_tauri_build_args=(--config "$local_app_stable_tauri_config_path")
    local_app_icon_source_path="$mindflow_identity_gui_dir/src-tauri/icons/icon.icns"
    local_app_obsolete_name="Mind Dev"
    ;;
esac

local_app_bundle_path="$mindflow_identity_release_dir/$local_app_name.app"
local_app_info_path="$local_app_bundle_path/Contents/Info.plist"
local_app_executable_path="$local_app_bundle_path/Contents/MacOS/$local_app_executable_name"
local_app_bundle_icon_path="$local_app_bundle_path/Contents/Resources/icon.icns"
local_app_relative_executable_path="target/release/bundle/macos/$local_app_name.app/Contents/MacOS/$local_app_executable_name"
local_app_obsolete_bundle_path="$mindflow_identity_release_dir/$local_app_obsolete_name.app"

mindflow_print_local_app_identity() {
  printf 'variant: %s\n' "$local_app_variant"
  printf 'product: %s\n' "$local_app_name"
  printf 'identifier: %s\n' "$local_app_identifier"
  printf 'bundle: %s\n' "$local_app_bundle_path"
  printf 'executable: %s\n' "$local_app_executable_path"
  printf 'icon: %s\n' "$local_app_icon_source_path"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --print | "")
      mindflow_print_local_app_identity
      ;;
    *)
      echo "usage: $0 [--print]" >&2
      exit 2
      ;;
  esac
fi
