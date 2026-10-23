#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gui_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$gui_dir/.." && pwd)"
# shellcheck source=local-app-identity.sh
source "$script_dir/local-app-identity.sh"
app_executable="${MINDFLOW_TEST_APP_EXECUTABLE:-$local_app_executable_path}"
project_root="$repo_root"
smoke_seconds="${MINDFLOW_TEST_WINDOW_SMOKE_SECONDS:-1}"
forward_root=""
new_window_root=""
hold=false
test_command=()

while (($# > 0)); do
  case "$1" in
    --root)
      if (($# < 2)); then
        echo "error: --root requires a path" >&2
        exit 2
      fi
      project_root="$2"
      shift 2
      ;;
    --forward-root)
      if (($# < 2)); then
        echo "error: --forward-root requires a path" >&2
        exit 2
      fi
      forward_root="$2"
      shift 2
      ;;
    --new-window-root)
      if (($# < 2)); then
        echo "error: --new-window-root requires a path" >&2
        exit 2
      fi
      new_window_root="$2"
      shift 2
      ;;
    --smoke-seconds)
      if (($# < 2)); then
        echo "error: --smoke-seconds requires a duration" >&2
        exit 2
      fi
      smoke_seconds="$2"
      shift 2
      ;;
    --hold)
      hold=true
      shift
      ;;
    --)
      shift
      test_command=("$@")
      break
      ;;
    *)
      echo "error: unsupported argument '$1'" >&2
      echo "usage: $0 [--root PATH] [--forward-root PATH] [--new-window-root PATH] [--smoke-seconds SECONDS] [--hold] [-- COMMAND ...]" >&2
      exit 2
      ;;
  esac
done

if $hold && ((${#test_command[@]} > 0)); then
  echo "error: --hold and a test command cannot be used together" >&2
  exit 2
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: isolated Mindflow window testing currently requires macOS" >&2
  exit 1
fi
if [[ "${MINDFLOW_TEST_SKIP_FRESHNESS_CHECK:-0}" != "1" ]]; then
  "$script_dir/sync-local-app.sh" --check --quiet
fi
if [[ ! -x "$app_executable" ]]; then
  echo "error: Mindflow test executable is missing: $app_executable" >&2
  exit 1
fi

test_root="$(mktemp -d "${TMPDIR:-/tmp}/mindflow-window-test.XXXXXX")"
test_log="$test_root/mindflow.log"
handoff_log="$test_root/open-requests.log"
test_namespace="window-$$-${test_root##*.}"
test_pid=""
forwarded_pid=""
preexisting_pids=()

process_running() {
  local process_id="$1"
  local process_state
  process_state="$(ps -p "$process_id" -o stat= 2>/dev/null || true)"
  [[ -n "$process_state" && "$process_state" != Z* ]]
}

launch_forwarded() {
  local forwarded_arguments=("$@")
  (
    unset MINDFLOW_ROOT
    export MINDFLOW_ISOLATED_TEST_INSTANCE="$test_namespace"
    exec "$app_executable" "${forwarded_arguments[@]}"
  ) >>"$test_log" 2>&1 &
  forwarded_pid=$!
  for _ in {1..50}; do
    process_running "$forwarded_pid" || break
    sleep 0.1
  done
  if process_running "$forwarded_pid"; then
    echo "error: forwarded Mindflow launch did not hand off to the isolated primary" >&2
    return 1
  fi
  if ! wait "$forwarded_pid"; then
    echo "error: forwarded Mindflow launch exited unsuccessfully" >&2
    return 1
  fi
  forwarded_pid=""
  if ! process_running "$test_pid"; then
    echo "error: isolated Mindflow primary exited during launch forwarding" >&2
    return 1
  fi
}

wait_for_handoff_count() {
  local expected_count="$1"
  local observed_count=0
  for _ in {1..50}; do
    if [[ -f "$handoff_log" ]]; then
      observed_count="$(rg -c '^received[[:space:]]' "$handoff_log" || true)"
      observed_count="${observed_count:-0}"
    fi
    [[ "$observed_count" -ge "$expected_count" ]] && return 0
    sleep 0.1
  done
  echo "error: isolated primary recorded $observed_count of $expected_count forwarded launches" >&2
  return 1
}

wait_for_activation_count() {
  local expected_count="$1"
  local observed_count=0
  for _ in {1..50}; do
    if [[ -f "$handoff_log" ]]; then
      observed_count="$(rg -c '^activation[[:space:]]+completed[[:space:]]' "$handoff_log" || true)"
      observed_count="${observed_count:-0}"
    fi
    [[ "$observed_count" -ge "$expected_count" ]] && return 0
    sleep 0.1
  done
  echo "error: isolated primary completed $observed_count of $expected_count window activations" >&2
  return 1
}

wait_for_created_window_count() {
  local expected_count="$1"
  local observed_count=0
  for _ in {1..100}; do
    if [[ -f "$handoff_log" ]]; then
      observed_count="$(rg -c '^window[[:space:]]+created[[:space:]]' "$handoff_log" || true)"
      observed_count="${observed_count:-0}"
    fi
    [[ "$observed_count" -ge "$expected_count" ]] && return 0
    sleep 0.1
  done
  echo "error: isolated primary created $observed_count of $expected_count requested native windows" >&2
  return 1
}

wait_for_ui_window_count() {
  local expected_count="$1"
  local observed_count=0
  for _ in {1..100}; do
    if [[ -f "$handoff_log" ]]; then
      observed_count="$(awk -F '\t' '$1 == "ui" { seen[$2] = 1 } END { print length(seen) + 0 }' "$handoff_log")"
    fi
    [[ "$observed_count" -ge "$expected_count" ]] && return 0
    sleep 0.1
  done
  echo "error: isolated primary initialized $observed_count of $expected_count native-window frontends" >&2
  return 1
}

native_window_stats_for_pid() {
  local process_id="$1"
  /usr/bin/osascript -l JavaScript - "$process_id" <<'JXA'
function run(argv) {
  ObjC.import('Cocoa');
  ObjC.bindFunction('CGWindowListCopyWindowInfo', ['id', ['uint32', 'uint32']]);
  const pid = Number(argv[0]);
  const onScreenAndNoDesktop = 1 | 16;
  const windows = ObjC.deepUnwrap(
    $.CGWindowListCopyWindowInfo(onScreenAndNoDesktop, 0),
  );
  const matches = windows.filter((window) =>
    Number(window.kCGWindowOwnerPID) === pid &&
    Number(window.kCGWindowLayer) === 0 &&
    Number(window.kCGWindowAlpha) > 0
  );
  const origins = new Set(matches.map((window) =>
    `${window.kCGWindowBounds.X},${window.kCGWindowBounds.Y}`
  ));
  return `${matches.length}\t${origins.size}`;
}
JXA
}

wait_for_native_window_count() {
  local expected_count="$1"
  local observed_count=0
  local observed_origins=0
  for _ in {1..100}; do
    read -r observed_count observed_origins <<<"$(native_window_stats_for_pid "$test_pid")"
    if [[ "$observed_count" -ge "$expected_count" ]] &&
      [[ "$observed_origins" -ge "$expected_count" ]]; then
      return 0
    fi
    process_running "$test_pid" || break
    sleep 0.1
  done
  echo "error: PID $test_pid owns $observed_count windows at $observed_origins distinct origins; expected $expected_count" >&2
  return 1
}

while IFS= read -r process_id; do
  [[ -n "$process_id" ]] || continue
  preexisting_pids+=("$process_id")
done < <(pgrep -x mindflow-desktop 2>/dev/null || true)

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if [[ -n "$forwarded_pid" ]] && process_running "$forwarded_pid"; then
    kill "$forwarded_pid" 2>/dev/null || true
  fi
  if [[ -n "$forwarded_pid" ]]; then
    wait "$forwarded_pid" 2>/dev/null || true
  fi

  if [[ -n "$test_pid" ]] && process_running "$test_pid"; then
    kill "$test_pid" 2>/dev/null || true
    for _ in {1..30}; do
      process_running "$test_pid" || break
      sleep 0.1
    done
    if process_running "$test_pid"; then
      kill -KILL "$test_pid" 2>/dev/null || true
    fi
  fi
  if [[ -n "$test_pid" ]]; then
    wait "$test_pid" 2>/dev/null || true
  fi

  local process_id
  # macOS Bash 3 treats an empty array as unset under nounset.
  for process_id in ${preexisting_pids[@]+"${preexisting_pids[@]}"}; do
    if ! kill -0 "$process_id" 2>/dev/null; then
      echo "error: pre-existing Mindflow process $process_id disappeared during isolated window testing" >&2
      status=1
    fi
  done

  if [[ "$status" -ne 0 && -s "$test_log" ]]; then
    echo "Mindflow test-window output:" >&2
    sed -n '1,160p' "$test_log" >&2
  fi
  rm -rf "$test_root"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

(
  unset MINDFLOW_ROOT
  export MINDFLOW_ISOLATED_TEST_INSTANCE="$test_namespace"
  export MINDFLOW_TEST_OPEN_REQUEST_LOG="$handoff_log"
  exec "$app_executable" "$project_root"
) >"$test_log" 2>&1 &
test_pid=$!
if [[ -n "${MINDFLOW_TEST_PID_FILE:-}" ]]; then
  printf '%s\n' "$test_pid" >"$MINDFLOW_TEST_PID_FILE"
fi

for _ in {1..10}; do
  if ! process_running "$test_pid"; then
    wait "$test_pid" 2>/dev/null || true
    echo "error: isolated Mindflow test window exited before it became usable" >&2
    exit 1
  fi
  sleep 0.1
done

export MINDFLOW_TEST_APP_EXECUTABLE="$app_executable"
export MINDFLOW_TEST_APP_PID="$test_pid"
export MINDFLOW_TEST_APP_LOG="$test_log"
export MINDFLOW_TEST_INSTANCE_NAMESPACE="$test_namespace"
echo "Isolated local-app executable: $MINDFLOW_TEST_APP_EXECUTABLE"
echo "Isolated Mindflow test window started (PID $MINDFLOW_TEST_APP_PID)."

if [[ -n "$forward_root" || -n "$new_window_root" ]]; then
  singleton_ready=false
  for _ in {1..100}; do
    if lsof -a -p "$test_pid" -U -Fn 2>/dev/null | rg -q '_si\.sock$'; then
      singleton_ready=true
      break
    fi
    process_running "$test_pid" || break
    sleep 0.1
  done
  if ! $singleton_ready; then
    echo "error: isolated Mindflow primary did not establish its singleton endpoint" >&2
    exit 1
  fi

  expected_handoffs=0
  if [[ -n "$forward_root" ]]; then
    launch_forwarded "$forward_root"
    expected_handoffs=$((expected_handoffs + 1))
    wait_for_handoff_count "$expected_handoffs"
    launch_forwarded "$project_root"
    expected_handoffs=$((expected_handoffs + 1))
    wait_for_handoff_count "$expected_handoffs"
    echo "Isolated repeated later-launch reuse passed."
  fi

  if [[ -n "$new_window_root" ]]; then
    launch_forwarded --mindflow-window-mode new "$new_window_root"
    expected_handoffs=$((expected_handoffs + 1))
    wait_for_handoff_count "$expected_handoffs"
    wait_for_created_window_count 1
    wait_for_ui_window_count 2
    wait_for_native_window_count 2
    echo "Isolated same-process native-window creation passed."
  fi
  wait_for_activation_count "$expected_handoffs"
fi

if ((${#test_command[@]} > 0)); then
  "${test_command[@]}"
elif $hold; then
  echo "The isolated test window will close when this command is interrupted."
  while process_running "$test_pid"; do
    sleep 1
  done
  echo "error: isolated Mindflow test window closed before the harness" >&2
  exit 1
else
  sleep "$smoke_seconds"
fi

echo "Isolated Mindflow test window passed; closing PID $test_pid only."
