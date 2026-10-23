#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gui_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$gui_dir/.." && pwd)"

bash -n "$repo_root/bin/mindflow"
bash -n "$repo_root/bin/mindflow-observe"
bash -n "$repo_root/bin/mindflow-app"
bash -n "$script_dir/local-app-identity.sh"
bash -n "$script_dir/generate-development-icons.sh"
bash -n "$script_dir/sync-local-app.sh"
bash -n "$script_dir/test-local-app-window.sh"

expected_development_app_name="Mind Dev"
expected_development_identifier="dev.mindflow.desktop.development"
tauri_config_path="$gui_dir/src-tauri/tauri.conf.json"
actual_product_name="$(/usr/bin/plutil -extract productName raw -o - "$tauri_config_path")"
actual_identifier="$(/usr/bin/plutil -extract identifier raw -o - "$tauri_config_path")"
actual_window_title="$(/usr/bin/plutil -extract app.windows.0.title raw -o - "$tauri_config_path")"
actual_development_icon="$(/usr/bin/plutil -extract bundle.icon.3 raw -o - "$tauri_config_path")"
if [[ "$actual_product_name" != "$expected_development_app_name" ]] ||
  [[ "$actual_window_title" != "$expected_development_app_name" ]] ||
  [[ "$actual_identifier" != "$expected_development_identifier" ]] ||
  [[ "$actual_development_icon" != "icons/development/icon.icns" ]]; then
  echo "error: Tauri development identity is not the repository's Mind Dev identity" >&2
  exit 1
fi

expected_stable_app_name="Mindflow"
expected_stable_identifier="dev.mindflow.desktop"
stable_tauri_config_path="$gui_dir/src-tauri/tauri.stable.conf.json"
actual_stable_product_name="$(/usr/bin/plutil -extract productName raw -o - "$stable_tauri_config_path")"
actual_stable_identifier="$(/usr/bin/plutil -extract identifier raw -o - "$stable_tauri_config_path")"
actual_stable_window_title="$(/usr/bin/plutil -extract app.windows.0.title raw -o - "$stable_tauri_config_path")"
actual_stable_icon="$(/usr/bin/plutil -extract bundle.icon.3 raw -o - "$stable_tauri_config_path")"
if [[ "$actual_stable_product_name" != "$expected_stable_app_name" ]] ||
  [[ "$actual_stable_window_title" != "$expected_stable_app_name" ]] ||
  [[ "$actual_stable_identifier" != "$expected_stable_identifier" ]] ||
  [[ "$actual_stable_icon" != "icons/icon.icns" ]]; then
  echo "error: Tauri stable overlay is not the repository's Mindflow identity" >&2
  exit 1
fi
if cmp -s \
  "$gui_dir/src-tauri/icons/development/icon.icns" \
  "$gui_dir/src-tauri/icons/icon.icns"; then
  echo "error: Mind Dev and stable Mindflow must not share one packaged icon" >&2
  exit 1
fi

if grep -Eq '^[[:space:]]*(kill|killall|pkill)[[:space:]]' "$script_dir/sync-local-app.sh"; then
  echo "error: synchronization must not signal a running Mindflow process" >&2
  exit 1
fi
if grep -Eq '^[[:space:]]*(killall|pkill)[[:space:]]' "$script_dir/test-local-app-window.sh"; then
  echo "error: isolated app testing must never target processes by shared name" >&2
  exit 1
fi

test_root="$(mktemp -d "${TMPDIR:-/tmp}/mindflow-local-toolchain-test.XXXXXX")"
test_root="$(cd "$test_root" && pwd)"
active_fixture_pid=""
cleanup_fixture() {
  if [[ -n "$active_fixture_pid" ]] && kill -0 "$active_fixture_pid" 2>/dev/null; then
    kill "$active_fixture_pid" 2>/dev/null || true
    wait "$active_fixture_pid" 2>/dev/null || true
  fi
  rm -rf "$test_root"
}
trap cleanup_fixture EXIT

fixture_root="$test_root/checkout with spaces"
consumer_root="$test_root/consumer project"
fake_path="$test_root/fake path"
open_log="$test_root/open.log"
mkdir -p \
  "$fixture_root/bin" \
  "$fixture_root/gui/scripts" \
  "$fixture_root/gui/src-tauri/target/release/bundle/macos/Mind Dev.app" \
  "$fixture_root/gui/src-tauri/target/release/bundle/macos/Mindflow.app" \
  "$fixture_root/target/release" \
  "$consumer_root" \
  "$fake_path"
consumer_root="$(cd "$consumer_root" && pwd)"

cp "$repo_root/bin/mindflow" "$fixture_root/bin/mindflow"
cp "$repo_root/bin/mindflow-observe" "$fixture_root/bin/mindflow-observe"
cp "$repo_root/bin/mindflow-app" "$fixture_root/bin/mindflow-app"
cp "$script_dir/local-app-identity.sh" "$fixture_root/gui/scripts/local-app-identity.sh"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s" "${MINDFLOW_TEST_CHECK_MESSAGE:-}" >&2' \
  'exit "${MINDFLOW_TEST_CHECK_EXIT:-0}"' \
  > "$fixture_root/gui/scripts/sync-local-app.sh"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "cwd=%s\\n" "$PWD"' \
  'for argument in "$@"; do printf "arg=%s\\n" "$argument"; done' \
  'exit "${MINDFLOW_TEST_CLI_EXIT:-0}"' \
  > "$fixture_root/target/release/mindflow"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "cwd=%s\n" "$PWD"' \
  'for argument in "$@"; do printf "observer-arg=%s\n" "$argument"; done' \
  'exit "${MINDFLOW_TEST_OBSERVER_EXIT:-0}"' \
  > "$fixture_root/target/release/mindflow-observe"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  ': > "$MINDFLOW_TEST_OPEN_LOG"' \
  'for argument in "$@"; do printf "%s\\n" "$argument" >> "$MINDFLOW_TEST_OPEN_LOG"; done' \
  > "$fake_path/open"

chmod +x \
  "$fixture_root/bin/mindflow" \
  "$fixture_root/bin/mindflow-observe" \
  "$fixture_root/bin/mindflow-app" \
  "$fixture_root/gui/scripts/local-app-identity.sh" \
  "$fixture_root/gui/scripts/sync-local-app.sh" \
  "$fixture_root/target/release/mindflow" \
  "$fixture_root/target/release/mindflow-observe" \
  "$fake_path/open"

set +e
cli_output="$(
  cd "$consumer_root" &&
    MINDFLOW_TEST_CLI_EXIT=7 "$fixture_root/bin/mindflow" alpha "two words"
)"
cli_status=$?
set -e

if [[ "$cli_status" -ne 7 ]]; then
  echo "error: CLI launcher did not preserve the executable exit status" >&2
  exit 1
fi
expected_cli_output="$(printf 'cwd=%s\narg=alpha\narg=two words' "$consumer_root")"
if [[ "$cli_output" != "$expected_cli_output" ]]; then
  echo "error: CLI launcher changed the caller directory, arguments, or output" >&2
  exit 1
fi

set +e
observer_output="$(
  cd "$consumer_root" &&
    MINDFLOW_TEST_OBSERVER_EXIT=9 "$fixture_root/bin/mindflow-observe" report "bundle path"
)"
observer_status=$?
set -e
if [[ "$observer_status" -ne 9 ]]; then
  echo "error: runtime-observer launcher did not preserve the executable exit status" >&2
  exit 1
fi
expected_observer_output="$(printf 'cwd=%s\nobserver-arg=report\nobserver-arg=bundle path' "$consumer_root")"
if [[ "$observer_output" != "$expected_observer_output" ]]; then
  echo "error: runtime-observer launcher changed the caller directory, arguments, or output" >&2
  exit 1
fi

set +e
stale_error="$(
  MINDFLOW_TEST_CHECK_EXIT=1 \
    MINDFLOW_TEST_CHECK_MESSAGE='fixture is stale' \
    "$fixture_root/bin/mindflow" check 2>&1
)"
stale_status=$?
set -e
if [[ "$stale_status" -ne 1 || "$stale_error" != "fixture is stale" ]]; then
  echo "error: CLI launcher did not fail closed through the freshness check" >&2
  exit 1
fi

set +e
stale_observer_error="$(
  MINDFLOW_TEST_CHECK_EXIT=1 \
    MINDFLOW_TEST_CHECK_MESSAGE='observer fixture is stale' \
    "$fixture_root/bin/mindflow-observe" report bundle 2>&1
)"
stale_observer_status=$?
set -e
if [[ "$stale_observer_status" -ne 1 || "$stale_observer_error" != "observer fixture is stale" ]]; then
  echo "error: runtime-observer launcher did not fail closed through the freshness check" >&2
  exit 1
fi

PATH="$fake_path:$PATH" \
  MINDFLOW_TEST_OPEN_LOG="$open_log" \
  "$fixture_root/bin/mindflow-app" "/first project" "/second project"
expected_open_log="$(printf '%s\n' \
  '-n' \
  "$fixture_root/gui/src-tauri/target/release/bundle/macos/Mind Dev.app" \
  '--args' \
  '--mindflow-window-mode' \
  'reuse' \
  '/first project' \
  '/second project')"
if [[ "$(<"$open_log")" != "$expected_open_log" ]]; then
  echo "error: app launcher did not preserve explicit starting-path order" >&2
  exit 1
fi

(
  cd "$consumer_root"
  PATH="$fake_path:$PATH" \
    MINDFLOW_TEST_OPEN_LOG="$open_log" \
    "$fixture_root/bin/mindflow-app" "nested project"
)
expected_open_log="$(printf '%s\n' \
  '-n' \
  "$fixture_root/gui/src-tauri/target/release/bundle/macos/Mind Dev.app" \
  '--args' \
  '--mindflow-window-mode' \
  'reuse' \
  "$consumer_root/nested project")"
if [[ "$(<"$open_log")" != "$expected_open_log" ]]; then
  echo "error: app launcher did not resolve a relative path from the caller directory" >&2
  exit 1
fi

(
  cd "$consumer_root"
  PATH="$fake_path:$PATH" \
    MINDFLOW_TEST_OPEN_LOG="$open_log" \
    "$fixture_root/bin/mindflow-app"
)
expected_open_log="$(printf '%s\n' \
  '-n' \
  "$fixture_root/gui/src-tauri/target/release/bundle/macos/Mind Dev.app" \
  '--args' \
  '--mindflow-window-mode' \
  'reuse' \
  '--mindflow-caller-cwd' \
  "$consumer_root")"
if [[ "$(<"$open_log")" != "$expected_open_log" ]]; then
  echo "error: app launcher did not hand off the caller directory" >&2
  exit 1
fi

PATH="$fake_path:$PATH" \
  MINDFLOW_TEST_OPEN_LOG="$open_log" \
  "$fixture_root/bin/mindflow-app" --new-window "/new window project"
expected_open_log="$(printf '%s\n' \
  '-n' \
  "$fixture_root/gui/src-tauri/target/release/bundle/macos/Mind Dev.app" \
  '--args' \
  '--mindflow-window-mode' \
  'new' \
  '/new window project')"
if [[ "$(<"$open_log")" != "$expected_open_log" ]]; then
  echo "error: app launcher did not preserve explicit new-window routing" >&2
  exit 1
fi

(
  cd "$consumer_root"
  PATH="$fake_path:$PATH" \
    MINDFLOW_TEST_OPEN_LOG="$open_log" \
    "$fixture_root/bin/mindflow-app" -- --path-starting-with-a-hyphen
)
expected_open_log="$(printf '%s\n' \
  '-n' \
  "$fixture_root/gui/src-tauri/target/release/bundle/macos/Mind Dev.app" \
  '--args' \
  '--mindflow-window-mode' \
  'reuse' \
  "$consumer_root/--path-starting-with-a-hyphen")"
if [[ "$(<"$open_log")" != "$expected_open_log" ]]; then
  echo "error: app launcher did not preserve a path after the option terminator" >&2
  exit 1
fi

git -C "$fixture_root" init -q
git -C "$fixture_root" config extensions.worktreeConfig true
git -C "$fixture_root" config --worktree mindflow.localAppVariant stable
PATH="$fake_path:$PATH" \
  MINDFLOW_TEST_OPEN_LOG="$open_log" \
  "$fixture_root/bin/mindflow-app" "/stable project"
expected_open_log="$(printf '%s\n' \
  '-n' \
  "$fixture_root/gui/src-tauri/target/release/bundle/macos/Mindflow.app" \
  '--args' \
  '--mindflow-window-mode' \
  'reuse' \
  '/stable project')"
if [[ "$(<"$open_log")" != "$expected_open_log" ]]; then
  echo "error: app launcher did not honor the worktree-local stable identity" >&2
  exit 1
fi

set +e
conflicting_window_mode_error="$(
  "$fixture_root/bin/mindflow-app" --new-window --reuse-window 2>&1
)"
conflicting_window_mode_status=$?
set -e
if [[ "$conflicting_window_mode_status" -ne 2 ]] ||
  [[ "$conflicting_window_mode_error" != *"choose exactly one"* ]]; then
  echo "error: app launcher did not reject conflicting window modes" >&2
  exit 1
fi

isolated_pid_file="$test_root/isolated.pid"
/bin/sleep 30 &
active_fixture_pid=$!
# Exercise cleanup with no existing app instances, even if the user's app is open.
printf '%s\n' '#!/bin/sh' 'exit 1' > "$fake_path/pgrep"
chmod +x "$fake_path/pgrep"
isolated_output="$(
  PATH="$fake_path:$PATH" MINDFLOW_TEST_APP_EXECUTABLE=/bin/sleep \
    MINDFLOW_TEST_SKIP_FRESHNESS_CHECK=1 \
    MINDFLOW_TEST_PID_FILE="$isolated_pid_file" \
    "$script_dir/test-local-app-window.sh" --root 30 --smoke-seconds 0.1
)"
isolated_pid="$(<"$isolated_pid_file")"
if [[ "$isolated_output" != *"Isolated local-app executable: /bin/sleep"* ]] ||
  [[ "$isolated_output" != *"started (PID $isolated_pid)"* ]]; then
  echo "error: isolated app test did not report its exact executable and owned PID" >&2
  exit 1
fi
if kill -0 "$isolated_pid" 2>/dev/null; then
  echo "error: isolated app test left its own process running" >&2
  exit 1
fi
if ! kill -0 "$active_fixture_pid" 2>/dev/null; then
  echo "error: isolated app test disturbed a pre-existing process" >&2
  exit 1
fi

failed_pid_file="$test_root/failed-isolated.pid"
set +e
MINDFLOW_TEST_APP_EXECUTABLE=/bin/sleep \
  MINDFLOW_TEST_SKIP_FRESHNESS_CHECK=1 \
  MINDFLOW_TEST_PID_FILE="$failed_pid_file" \
  "$script_dir/test-local-app-window.sh" --root 30 -- /usr/bin/false
failed_harness_status=$?
set -e
failed_isolated_pid="$(<"$failed_pid_file")"
if [[ "$failed_harness_status" -eq 0 ]]; then
  echo "error: isolated app test hid a failing test command" >&2
  exit 1
fi
if kill -0 "$failed_isolated_pid" 2>/dev/null; then
  echo "error: failed isolated app test left its own process running" >&2
  exit 1
fi
if ! kill -0 "$active_fixture_pid" 2>/dev/null; then
  echo "error: failed isolated app test disturbed a pre-existing process" >&2
  exit 1
fi

echo "Local toolchain launcher tests passed."
