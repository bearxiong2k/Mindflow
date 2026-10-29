#!/usr/bin/env bash

set -euo pipefail

if (($# != 1)); then
  echo "usage: $0 MINDFLOW_EXECUTABLE" >&2
  exit 2
fi

mindflow_command="$1"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
asset_root="$script_dir/../skills/structuralist/assets/recipe"

python3 - "$mindflow_command" "$asset_root" <<'PY'
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote

command, assets = sys.argv[1:]
assets = Path(assets)


def yaml_document(path):
    # Ruby/Psych is already required by the package validator.
    return json.loads(subprocess.check_output([
        "ruby", "-ryaml", "-rjson", "-e",
        "puts JSON.generate(YAML.safe_load(File.read(ARGV[0]), aliases: false))",
        str(path),
    ], text=True))


def run(root, *arguments):
    return subprocess.check_output(
        [command, "--root", str(root), *arguments], text=True)


def probe(root, *address):
    return json.loads(run(root, "topology", "probe", *address,
                          "--depth", "1", "--max-nodes", "128", "--json"))


def edges(relationships):
    return {(r["source"], r["type"], r["direction"], r["target"])
            for r in relationships}


def check_links(root):
    # Check links after materialization: extension prose uses target-root paths.
    root = root.resolve()
    for source in root.rglob("*.md"):
        text = source.read_text()
        assert not re.search(r"\{\{[A-Z_]+\}\}", text), source
        for link in re.findall(r"\[[^\]]*\]\(([^)]+)\)", text):
            if re.match(r"(?:https?://|mailto:)", link):
                continue
            path, _, fragment = unquote(link).partition("#")
            target = (source.parent / path).resolve() if path else source
            assert target.is_relative_to(root), (source, link)
            assert target.exists(), (source, link)
            if fragment:
                headings = re.findall(r"^#+\s+(.+)$", target.read_text(), re.M)
                anchors = {re.sub(r"[^\w\- ]", "", h.lower()).replace(" ", "-")
                           for h in headings}
                assert fragment in anchors, (source, link)


def check_example(root, opening_id):
    subprocess.run(["git", "-C", str(root), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    assert json.loads(run(root, "check", "--json"))["valid"]
    check_links(root)

    status = json.loads(run(root, "status", "--json"))
    version = json.loads(run(root, "version", "--json"))
    assert version["project"]["adopted_release"] == "2026.10.27"
    assert status["schema"] == "mindflow-status/v6"
    region = status["region"]
    assert region["format"] == "2026-10-27"
    assert region["schema"] == "mindflow-region-index/v7"
    assert "roles" not in region and "project_map" not in region

    manifest = yaml_document(root / "MINDFLOW.yaml")
    for identity, component in manifest["components"].items():
        path = root / component["path"]
        if path.suffix == ".md":
            assert run(root, "topology", "read", identity) == path.read_text()

    opening = json.loads(run(root, "opening", "show", "--json"))
    assert opening["files"] == [{
        "component": opening_id,
        "path": manifest["components"][opening_id]["path"],
    }]
    page = json.loads(run(root, "evolve", "events", "--json"))
    assert page["schema"] == "mindflow-evolve-event-page/v3"
    events = page["events"]
    assert page["total"] == len(events) == 3
    assert [e["component"] for e in events] == [
        "browsing_summary", "browsing_question", "browsing_evidence"]
    assert events[0]["children"] == ["browsing_question", "browsing_evidence"]
    assert all(e["children"] == [] for e in events[1:])
    assert all("opening" not in e for e in events)
    for event in events:
        content = (root / event["file"]).read_bytes()
        assert event["content"] == {
            "sha256": "sha256:" + hashlib.sha256(content).hexdigest(),
            "bytes": len(content),
        }

    before = json.loads(run(root, "map"))
    assert all(node["name"] == Path(node["path"]).name
               for node in before["nodes"] if node["path"] != ".")
    run(root, "topology", "view", "--depth", "3", "--max-nodes", "512", "--json")
    generated = run(root, "topology", "view", "--depth", "3",
                    "--max-nodes", "512", "--mermaid")
    assert generated.startswith("flowchart TD\n") and "snapshot=" in generated
    export = root / "PROJECT_MAP.mmd"
    assert not export.exists(), "recipe must not ship an authored Mermaid carrier"
    for text in (generated, "This is deliberately not Mermaid.\n"):
        export.write_text(text)
        assert json.loads(run(root, "map")) == before
    export.unlink()
    assert json.loads(run(root, "map")) == before
    return events


with tempfile.TemporaryDirectory(prefix="mindflow-structuralist-recipe-") as tmp:
    compact = Path(tmp) / "compact"
    shutil.copytree(assets / "compact", compact)
    original_events = check_example(compact, "browsing_evidence")
    # This example deliberately uses prose links and containment, not invented edges.
    assert probe(compact)["structure"]["relationships"] == []

    extended = Path(tmp) / "with-steering"
    shutil.copytree(assets / "compact", extended)
    extension = assets / "extensions/steering"
    shutil.copytree(extension / "long_term_steering", extended / "long_term_steering")
    manifest = yaml_document(extended / "MINDFLOW.yaml")
    additions = yaml_document(extension / "manifest-additions.yaml")
    for field in ("components", "relationship-types"):
        assert not (manifest[field].keys() & additions[field].keys())
        manifest[field].update(additions[field])
    manifest["relationships"].extend(additions["relationships"])
    manifest["opening"] = additions["opening"]
    # JSON is valid YAML; no extra Python YAML dependency is needed for fixtures.
    (extended / "MINDFLOW.yaml").write_text(json.dumps(manifest, indent=2) + "\n")
    assert check_example(extended, "visit_comparison") == original_events

    relation = ("steering", "tracks development of", "source-to-target", "project_account")
    assert relation in edges(probe(extended)["structure"]["relationships"])
    scope = probe(extended, "long_term_steering")
    assert scope["structure"]["focus"]["component"]["id"] == "steering"
    assert relation in edges([i["relationship"] for i in scope["incidences"]])

print("Structuralist compact and extended recipes validate: exact prose, links, "
      "summary children, independent Opening, and scoped relationships")
PY
