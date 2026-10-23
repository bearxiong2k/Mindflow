#!/usr/bin/env bash

set -euo pipefail

if (($# != 1)); then
  echo "usage: $0 MINDFLOW_EXECUTABLE" >&2
  exit 2
fi

mindflow_command="$1"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mindflow_root="$(cd "$script_dir/.." && pwd)"
asset_root="$mindflow_root/skills/structuralist/assets/recipe"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/mindflow-structuralist-recipe.XXXXXX")"

cleanup() {
  rm -rf "$fixture_root"
}
trap cleanup EXIT

cp -R "$asset_root/." "$fixture_root/"
find "$fixture_root" -type f -exec perl -pi -e '
  s/\{\{PROJECT_NAME\}\}/Fixture Project/g;
  s/\{\{PROJECT_PURPOSE\}\}/Fixture Project keeps one behavior understandable across human-agent development./g;
  s/\{\{PROJECT_USERS\}\}/Project maintainers and their agents use it together./g;
  s/\{\{PROJECT_BOUNDARY\}\}/It does not prescribe unrelated team workflow./g;
  s/\{\{SYSTEM_SUMMARY\}\}/One local component realizes the project contract./g;
  s/\{\{COMPONENT_CONTRACTS\}\}/The component reads one local input and returns one deterministic result./g;
  s/\{\{CURRENT_DEVELOPMENT_EDGE\}\}/Validate the initial contract against the first implementation./g;
' {} +

if grep -R -E '\{\{[A-Z_]+\}\}' "$fixture_root" >/dev/null; then
  echo "error: unresolved recipe template token" >&2
  exit 1
fi

if [[ -e "$fixture_root/PROJECT_MAP.mmd" ]]; then
  echo "error: the recipe must not ship an authored Mermaid carrier" >&2
  exit 1
fi

git -C "$fixture_root" init -q
git -C "$fixture_root" add .
"$mindflow_command" --root "$fixture_root" check --json
"$mindflow_command" --root "$fixture_root" map >/dev/null
"$mindflow_command" --root "$fixture_root" topology view \
  --depth 3 --max-nodes 512 --json >/dev/null
python3 - "$mindflow_command" "$fixture_root" <<'PY'
import json
import subprocess
import sys

command, root = sys.argv[1:]


def probe(*address):
    return json.loads(subprocess.check_output([
        command, "--root", root, "topology", "probe", *address,
        "--depth", "1", "--max-nodes", "128", "--json",
    ], text=True))


def edges(relationships):
    return {(r["source"], r["type"], r["direction"], r["target"])
            for r in relationships}


def require_edges(label, actual, expected):
    missing = expected - actual
    if missing:
        raise SystemExit(f"recipe {label} is missing authored meaning: {sorted(missing)}")


def run(*arguments):
    return subprocess.check_output([command, "--root", root, *arguments], text=True)

status = json.loads(run("status", "--json"))
versions = json.loads(run("version", "--json"))
assert versions["project"]["adopted_release"] == "2026.10.20"
assert status["schema"] == "mindflow-status/v6"
region = status["region"]
assert region["format"] == "2026-10-20" and region["schema"] == "mindflow-region-index/v5"
assert "roles" not in region and "project_map" not in region
assert len(region["documents"]) == 10
before = json.loads(run("map"))
assert all(node["name"] == node["path"].rsplit("/", 1)[-1]
           for node in before["nodes"] if node["path"] != ".")
from pathlib import Path
export = Path(root) / "PROJECT_MAP.mmd"
generated = run("topology", "view", "--depth", "3", "--max-nodes", "512", "--mermaid")
assert generated.startswith("flowchart TD\n") and "snapshot=" in generated
export.write_text(generated)
assert json.loads(run("map")) == before
export.write_text("This is deliberately not Mermaid.\n")
assert json.loads(run("map")) == before
export.unlink()
assert json.loads(run("map")) == before

# These are this recipe's commitments, not a connectivity policy for projects.
authority = {(source, "is governed by", "source-to-target", "governance")
             for source in ("profiles", "canonical", "deferred", "trim_guidance", "steering")}
authority.add(("canonical", "is governed by", "source-to-target", "profiles"))
steering = {("steering", "tracks development of", "source-to-target", target)
            for target in ("profiles", "canonical")}
overview = authority | steering
require_edges("root overview", edges(probe()["structure"]["relationships"]), overview)

for directory, identity in (("profiles", "profiles"), ("canonical_docs", "canonical"),
                            ("long_term_steering", "steering")):
    scope = probe(directory)
    if scope["structure"]["focus"]["component"]["id"] != identity:
        raise SystemExit(f"recipe directory {directory} resolves to the wrong owner")
    require_edges(f"{directory} incidence",
                  edges([i["relationship"] for i in scope["incidences"]]),
                  {r for r in overview if identity in (r[0], r[3])})
    if identity == "profiles":
        require_edges("profile peers", edges(scope["structure"]["relationships"]), {
            ("profile_product", "shares an evolving boundary with", "bidirectional",
             "profile_architecture"),
        })

print("Structuralist recipe root, folder incidence, and peer relationships are visible")
PY
"$mindflow_command" --root "$fixture_root" topology resolve \
  profile_product --json >/dev/null
"$mindflow_command" --root "$fixture_root" topology read \
  canonical_system >/dev/null
"$mindflow_command" --root "$fixture_root" opening show --json >/dev/null
"$mindflow_command" --root "$fixture_root" evolve events --json >/dev/null

echo "Structuralist recipe materialization fixture is valid"
