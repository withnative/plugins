#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Validate the first-party Native plugin catalogues and thin package contract."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "native"
ENDPOINT = "https://plugin.withnative.ai/mcp"
DESCRIPTION = (
    "Recover context and continue durable work through Native's hosted MCP service."
)
DEFAULT_PROMPT = (
    "Use $enter to recover the relevant context in my Native workspace and help me "
    "continue this work."
)
MPL_2_0_SHA256 = "3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04"
MPL_NOTICE = (
    "This Source Code Form is subject to the terms of the Mozilla Public\n"
    "License, v. 2.0. If a copy of the MPL was not distributed with this\n"
    "file, You can obtain one at https://mozilla.org/MPL/2.0/."
)
HASH_NOTICE = "\n".join(f"# {line}" for line in MPL_NOTICE.splitlines()) + "\n"
HTML_NOTICE = f"<!--\n{MPL_NOTICE}\n-->\n"


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AssertionError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc
    assert isinstance(value, dict), f"{path.relative_to(ROOT)} must contain an object"
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def validate_license() -> None:
    license_digest = hashlib.sha256((ROOT / "LICENSE").read_bytes()).hexdigest()
    require(
        license_digest == MPL_2_0_SHA256,
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
    require(
        "Copyright © 2026 AI Native Work, Inc." in readme,
        "README copyright notice drifted",
    )

    notice_prefixes = {
        ROOT / ".github" / "workflows" / "validate.yml": HASH_NOTICE,
        ROOT / ".gitignore": HASH_NOTICE,
        PLUGIN / "skills" / "enter" / "agents" / "openai.yaml": HASH_NOTICE,
        ROOT / "scripts" / "validate.py": f"#!/usr/bin/env python3\n{HASH_NOTICE}",
    }
    for path, prefix in notice_prefixes.items():
        require(
            path.read_text(encoding="utf-8").startswith(prefix),
            f"{path.relative_to(ROOT)} is missing the MPL Exhibit A notice",
        )


def validate_manifests() -> None:
    codex = load_json(PLUGIN / ".codex-plugin" / "plugin.json")
    claude = load_json(PLUGIN / ".claude-plugin" / "plugin.json")
    common = {
        "name": "native",
        "version": "0.1.0",
        "description": DESCRIPTION,
        "author": {"name": "Native", "url": "https://www.withnative.ai/"},
        "homepage": "https://personal.withnative.ai/",
        "repository": "https://github.com/withnative/plugins",
        "keywords": ["native", "workspace", "context", "mcp"],
        "skills": "./skills/",
        "mcpServers": "./.mcp.json",
    }
    for key, value in common.items():
        require(codex.get(key) == value, f"Codex manifest has unexpected {key}")
        require(claude.get(key) == value, f"Claude manifest has unexpected {key}")

    interface = codex.get("interface", {})
    require(interface.get("displayName") == "Native", "Codex display name must be Native")
    require(
        interface.get("shortDescription") == "Recover context and continue durable work.",
        "Codex short description drifted",
    )
    require(interface.get("developerName") == "Native", "Codex developer must be Native")
    require(interface.get("category") == "Productivity", "Codex category drifted")
    require(interface.get("capabilities") == ["Read", "Write"], "Capabilities drifted")
    require(interface.get("defaultPrompt") == [DEFAULT_PROMPT], "Default prompt drifted")

    forbidden = {"license", "privacyPolicyURL", "termsOfServiceURL", "hooks", "apps"}
    require(not (forbidden & codex.keys()), "Codex manifest contains deferred/forbidden fields")
    require(not (forbidden & claude.keys()), "Claude manifest contains deferred/forbidden fields")


def validate_mcp() -> None:
    mcp = load_json(PLUGIN / ".mcp.json")
    require(
        mcp == {"mcpServers": {"native": {"type": "http", "url": ENDPOINT}}},
        "MCP declaration must contain only the canonical hosted Native server",
    )


def validate_marketplaces() -> None:
    codex = load_json(ROOT / ".agents" / "plugins" / "marketplace.json")
    require(codex.get("name") == "withnative", "Codex marketplace identity drifted")
    require(codex.get("interface") == {"displayName": "Native"}, "Codex display drifted")
    entries = codex.get("plugins")
    require(isinstance(entries, list) and len(entries) == 1, "Codex catalogue must list one plugin")
    require(
        entries[0]
        == {
            "name": "native",
            "source": {"source": "local", "path": "./plugins/native"},
            "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
            "category": "Productivity",
        },
        "Codex catalogue entry drifted",
    )

    claude = load_json(ROOT / ".claude-plugin" / "marketplace.json")
    require(claude.get("name") == "withnative", "Claude marketplace identity drifted")
    require(claude.get("owner") == {"name": "Native"}, "Claude owner drifted")
    entries = claude.get("plugins")
    require(isinstance(entries, list) and len(entries) == 1, "Claude catalogue must list one plugin")
    require(entries[0].get("name") == "native", "Claude plugin identity drifted")
    require(entries[0].get("source") == "./plugins/native", "Claude source path drifted")
    require(entries[0].get("description") == DESCRIPTION, "Claude description drifted")


def validate_skill() -> None:
    skill_path = PLUGIN / "skills" / "enter" / "SKILL.md"
    skill = skill_path.read_text(encoding="utf-8")
    match = re.match(r"\A---\n(?P<header>.*?)\n---\n(?P<body>.*)\Z", skill, re.DOTALL)
    require(match is not None, "Skill must contain YAML frontmatter")
    header = match.group("header")
    body = match.group("body")
    require(re.search(r"^name: enter$", header, re.MULTILINE) is not None, "Skill name drifted")
    for phrase in ("save this for later", "React Native", "another system"):
        require(phrase in header, f"Skill activation boundary is missing {phrase!r}")
    for phrase in ("quickstart", "bootstrap", "https://github.com/withnative/plugins"):
        require(phrase in body, f"Skill handoff is missing {phrase!r}")

    presentation = (skill_path.parent / "agents" / "openai.yaml").read_text(encoding="utf-8")
    for phrase in (
        'display_name: "Enter your Native workspace"',
        'short_description: "Recover context and continue durable work."',
        f'default_prompt: "{DEFAULT_PROMPT}"',
        "allow_implicit_invocation: true",
    ):
        require(phrase in presentation, f"OpenAI presentation metadata is missing {phrase!r}")


def validate_thin_boundary() -> None:
    forbidden_names = {".app.json", "hooks", "hooks.json"}
    for path in PLUGIN.rglob("*"):
        require(path.name not in forbidden_names, f"Thin package contains forbidden path {path}")
        if path.is_file():
            text = path.read_text(encoding="utf-8")
            require("[TODO:" not in text, f"Placeholder remains in {path.relative_to(ROOT)}")
            require("staging.plugin.withnative.ai" not in text, "Static package must use production URL")


def main() -> int:
    checks = (
        validate_license,
        validate_manifests,
        validate_mcp,
        validate_marketplaces,
        validate_skill,
        validate_thin_boundary,
    )
    try:
        for check in checks:
            check()
    except (AssertionError, OSError, UnicodeDecodeError) as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 1
    print("Native plugin package validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
