#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Validate the marketplace-owned catalogue contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
NATIVE_DESCRIPTION = (
    "Keep the context behind your work fresh, connected and useful across your agents."
)
NATIVE_MANIFEST_DESCRIPTION = (
    "Recover context and continue durable work through Native's hosted MCP service."
)
SURF_DESCRIPTION = "Learn to surf the waves of AI and continually adapt how you work as AI changes."
NATIVE_URL = "https://github.com/withnative/native-plugin.git"
SURF_URL = "https://github.com/withnative/surf.git"
NATIVE_REF = "v0.1.1"
MPL_2_0_SHA256 = "3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04"
MPL_NOTICE = (
    "This Source Code Form is subject to the terms of the Mozilla Public\n"
    "License, v. 2.0. If a copy of the MPL was not distributed with this\n"
    "file, You can obtain one at https://mozilla.org/MPL/2.0/."
)
HASH_NOTICE = "\n".join(f"# {line}" for line in MPL_NOTICE.splitlines()) + "\n"
HTML_NOTICE = f"<!--\n{MPL_NOTICE}\n-->\n"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AssertionError(f"{path} is not valid JSON: {exc}") from exc
    require(isinstance(value, dict), f"{path} must contain an object")
    return value


def git_source(url: str, path: str, ref: str = "main") -> dict[str, str]:
    return {"source": "git-subdir", "url": url, "path": path, "ref": ref}


def validate_license() -> None:
    require(
        hashlib.sha256((ROOT / "LICENSE").read_bytes()).hexdigest() == MPL_2_0_SHA256,
        "LICENSE must contain the canonical, unmodified MPL 2.0 text",
    )

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    require(readme.startswith(HTML_NOTICE), "README is missing the MPL Exhibit A notice")
    require(
        "contents of this repository—including JSON and other\n"
        "formats that do not support comments—are licensed under the [Mozilla Public License\n"
        "2.0](LICENSE) (`MPL-2.0`)." in readme,
        "README must declare MPL-2.0 coverage for commentless formats",
    )
    require("Copyright © 2026 AI Native Work, Inc." in readme, "copyright notice drifted")

    prefixes = {
        ROOT / ".github" / "workflows" / "validate.yml": HASH_NOTICE,
        ROOT / ".gitignore": HASH_NOTICE,
        ROOT / "scripts" / "validate.py": f"#!/usr/bin/env python3\n{HASH_NOTICE}",
    }
    for path, prefix in prefixes.items():
        require(path.read_text(encoding="utf-8").startswith(prefix), f"{path} lacks MPL notice")


def validate_marketplaces() -> None:
    codex = load_json(ROOT / ".agents" / "plugins" / "marketplace.json")
    require(
        codex
        == {
            "name": "withnative",
            "interface": {"displayName": "Plugins by Native"},
            "plugins": [
                {
                    "name": "native",
                    "source": git_source(NATIVE_URL, "./plugins/native", NATIVE_REF),
                    "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
                    "category": "Productivity",
                },
                {
                    "name": "surf",
                    "source": git_source(SURF_URL, "./plugins/surf"),
                    "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
                    "category": "Productivity",
                },
            ],
        },
        "Codex marketplace contract drifted",
    )

    claude = load_json(ROOT / ".claude-plugin" / "marketplace.json")
    require(
        claude
        == {
            "name": "withnative",
            "owner": {"name": "Native"},
            "description": "Open-source plugins by Native, built around human outcomes",
            "plugins": [
                {
                    "name": "native",
                    "source": git_source(NATIVE_URL, "plugins/native", NATIVE_REF),
                    "description": NATIVE_DESCRIPTION,
                    "category": "Productivity",
                    "tags": ["workspace", "context", "agents", "mcp"],
                },
                {
                    "name": "surf",
                    "source": git_source(SURF_URL, "plugins/surf"),
                    "description": SURF_DESCRIPTION,
                    "category": "Productivity",
                    "tags": ["learning", "practice", "agents", "mcp"],
                },
            ],
        },
        "Claude marketplace contract drifted",
    )

    sources = [entry["source"] for manifest in (codex, claude) for entry in manifest["plugins"]]
    require(len(sources) == 4, "marketplaces must contain exactly two entries each")
    require(all(source["source"] == "git-subdir" for source in sources), "all sources must be remote")
    require(
        sources[0]["path"] == f"./{sources[2]['path']}"
        and sources[1]["path"] == f"./{sources[3]['path']}",
        "Codex and Claude source paths must differ only by the leading ./",
    )


def validate_readme() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    required = (
        "# Plugins by Native",
        "A small index of open-source plugins for working with AI, built around human outcomes.",
        "Learn to surf the waves of AI. Surf helps you continually adapt how you work as AI changes.",
        "Keep the context behind your work fresh, connected and useful across your agents.",
        "[Native](https://www.withnative.ai/) is the publisher.",
        "Adding `withnative/plugins` to Claude or\nChatGPT/Codex makes both available, but installs neither one.",
        "Each product repository owns its documentation, plugin package, releases, and support.",
    )
    for text in required:
        require(text in readme, f"README is missing accepted copy: {text!r}")

    prompts = re.findall(r"```text\n(.*?)\n```", readme, re.DOTALL)
    require(
        prompts
        == [
            "Use the install guide at https://github.com/withnative/surf to help me get started with Surf.",
            "Use the install guide at https://github.com/withnative/native-plugin to help me get started with Native.",
        ],
        "README must contain one accepted setup prompt per product",
    )
    require(readme.count("```") == 4, "README must not accumulate additional fenced guidance")

    lower = readme.lower()
    forbidden = (
        "hyve",
        "native core",
        "native ce",
        "mcp-stdio",
        "stdio",
        "docs/plugin-installation.md",
        "packaged in this repository",
        "this repository owns the native package",
    )
    for text in forbidden:
        require(text not in lower, f"README contains stale product guidance: {text!r}")


def validate_repository_boundary() -> None:
    require(not (ROOT / "docs" / "plugin-installation.md").exists(), "local setup guide remains")
    require(not (ROOT / "packages" / "mcp-stdio").exists(), "local stdio adapter remains")
    local_native = ROOT / "plugins" / "native"
    require(
        not local_native.exists() or not any(path.is_file() for path in local_native.rglob("*")),
        "local Native package remains",
    )
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    require("mcp-stdio" not in gitignore and "node_modules" not in gitignore, "stale ignores remain")


def validate_remote_native(repository: Path) -> None:
    plugin = repository.resolve() / "plugins" / "native"
    codex = load_json(plugin / ".codex-plugin" / "plugin.json")
    claude = load_json(plugin / ".claude-plugin" / "plugin.json")
    require(codex.get("name") == claude.get("name") == "native", "remote plugin name drifted")
    version = codex.get("version")
    require(
        isinstance(version, str)
        and re.fullmatch(r"\d+\.\d+\.\d+", version) is not None
        and claude.get("version") == version,
        "remote plugin versions must be matching semantic versions",
    )
    require(
        NATIVE_REF == f"v{version}",
        f"marketplace ref {NATIVE_REF!r} must be the release tag for remote "
        f"plugin version {version!r}",
    )
    expected = {
        "description": NATIVE_MANIFEST_DESCRIPTION,
        "author": {"name": "Native", "url": "https://www.withnative.ai/"},
        "repository": "https://github.com/withnative/native-plugin",
        "skills": "./skills/",
        "mcpServers": "./.mcp.json",
    }
    for key, value in expected.items():
        require(codex.get(key) == value, f"remote Codex metadata has unexpected {key}")
        require(claude.get(key) == value, f"remote Claude metadata has unexpected {key}")
    require(
        load_json(plugin / ".mcp.json")
        == {"mcpServers": {"native": {"type": "http", "url": "https://plugin.withnative.ai/mcp"}}},
        "remote Native MCP metadata drifted",
    )


def validate_remote_refs() -> None:
    """Every marketplace ref must resolve the way client installers resolve it.

    Client installers clone a `git-subdir` source with `git clone --branch <ref>`,
    which accepts only `refs/heads/*` and `refs/tags/*`. CI checkouts resolve by
    fetch instead, which additionally accepts a bare commit SHA -- so a ref can
    pass every other check here and still be uninstallable. `git ls-remote
    --heads --tags` matches exactly the refs `--branch` accepts, making it a
    faithful one-round-trip proxy for the real operation.
    """
    manifests = (
        load_json(ROOT / ".claude-plugin" / "marketplace.json"),
        load_json(ROOT / ".agents" / "plugins" / "marketplace.json"),
    )
    checked: list[tuple[str, str]] = []
    for manifest in manifests:
        for entry in manifest["plugins"]:
            source = entry["source"]
            pair = (source["url"], source["ref"])
            if pair not in checked:
                checked.append(pair)

    for url, ref in checked:
        try:
            completed = subprocess.run(
                ["git", "ls-remote", "--heads", "--tags", "--exit-code", "--", url, ref],
                capture_output=True,
                text=True,
                timeout=60,
                # Never block on a credential prompt: with output captured the
                # prompt is invisible, so this would present as a silent stall.
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise AssertionError(f"could not resolve {ref!r} against {url}: {exc}") from exc
        if completed.returncode == 0:
            continue
        # git exits 2 for "matched nothing" and 128 for unreachable/auth failures.
        # Conflating them would report a network blip as a bad ref.
        if completed.returncode == 2:
            raise AssertionError(
                f"marketplace ref {ref!r} is not a branch or tag on {url}, so the "
                f"`git clone --branch {ref}` that client installers run will fail "
                f"even though a CI checkout of it would succeed"
            )
        raise AssertionError(
            f"could not reach {url} to resolve {ref!r} (git exited "
            f"{completed.returncode}): {completed.stderr.strip()}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--native-plugin-dir",
        type=Path,
        help="optional checkout of withnative/native-plugin for marketplace-facing metadata checks",
    )
    parser.add_argument(
        "--check-remote-refs",
        action="store_true",
        help="resolve every marketplace ref against its remote (requires network)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_license()
        validate_marketplaces()
        validate_readme()
        validate_repository_boundary()
        if args.native_plugin_dir is not None:
            validate_remote_native(args.native_plugin_dir)
        if args.check_remote_refs:
            validate_remote_refs()
    except (AssertionError, KeyError, OSError, TypeError, UnicodeDecodeError) as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 1
    notes = []
    if args.native_plugin_dir is not None:
        notes.append("remote Native metadata")
    if args.check_remote_refs:
        notes.append("resolvable remote refs")
    suffix = f" with {' and '.join(notes)}" if notes else ""
    print(f"Marketplace validation passed{suffix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
