#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 - "$script_dir/.." "$@" <<'PY'
"""Copy the complete release skill without modifying any consuming project."""
import argparse
import filecmp
import pathlib
import shutil
import sys

root = pathlib.Path(sys.argv.pop(1)).resolve()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true", help="compare an installed copy with this source")
parser.add_argument("destination", nargs="?", type=pathlib.Path,
                    default=pathlib.Path.home() / ".agents/skills/structuralist",
                    help="exact skill directory (default: ~/.agents/skills/structuralist)")
args = parser.parse_args()
source = root / "skills/structuralist"
destination = args.destination.expanduser().absolute()
if not (source / "SKILL.md").is_file():
    parser.error("this checkout has no complete Structuralist package")
if destination.resolve() == source or source in destination.resolve().parents:
    parser.error("choose an installation directory outside the source package")

def equal_directories(left, right):
    comparison = filecmp.dircmp(left, right)
    if comparison.left_only or comparison.right_only or comparison.common_funny:
        return False
    if any(not filecmp.cmp(left / name, right / name, shallow=False)
           for name in comparison.common_files):
        return False
    return all(equal_directories(left / name, right / name)
               for name in comparison.common_dirs)

if args.check:
    if not destination.is_dir() or not equal_directories(source, destination):
        parser.error("installed package differs or is absent; inspect it before replacing it")
    print(f"Structuralist matches this source: {destination}")
    sys.exit(0)

if destination.exists() or destination.is_symlink():
    parser.error(f"destination already exists: {destination}; inspect or move it aside first")
destination.parent.mkdir(parents=True, exist_ok=True)
try:
    shutil.copytree(source, destination)
except OSError as error:
    parser.error(f"copy failed: {error}; inspect any partial destination before retrying")
print(f"Installed Structuralist: {destination}")
print("Confirm it appears in your agent's skill selector; refresh/restart the agent if needed.")
print("Invoke $structuralist explicitly. Installation has not adopted or changed a project.")
PY
