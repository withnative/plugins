<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# Native plugins

This repository is the first-party catalogue for Native plugins and workflow packs.

The first package is **Native**, a thin distribution layer that helps an agent recover
durable workspace context and continue work through Native's hosted MCP service. The
package provides product metadata, one entry skill, and an authenticated connection to
`https://plugin.withnative.ai/mcp`.

## Install

ChatGPT/Codex:

```sh
codex plugin marketplace add withnative/plugins
codex plugin add native@withnative
```

Claude Code:

```sh
claude plugin marketplace add withnative/plugins
claude plugin install native@withnative
```

Start a new conversation after installation and ask the agent to use Native, or invoke
`/native:enter` explicitly. The host owns OAuth: never paste a bearer token into the
plugin or its files.

Repository-installed plugin availability varies by client surface. Desktop and CLI
routes are the initial baseline; browser and mobile routes must be verified on the
specific account and client before support is claimed.

## Architecture

The package is intentionally small:

```text
client + installed plugin
          │
          │ host-managed OAuth and HTTPS
          ▼
https://plugin.withnative.ai/mcp
          │
          ▼
independently deployed Native CE service and databases
```

This repository owns installation metadata, the stable `/native:enter` activation
boundary, and the remote connection declaration. The independently deployed Native CE
service owns OAuth resource-server behaviour, tools, live guidance, permissions, and
durable data. No server implementation, database, workspace facts, credentials, or
copied guide corpus belongs in this catalogue.

The plugin and service can release independently. Their compatibility seam is the MCP
resource identity, OAuth discovery and audience behaviour, and the core `quickstart`
and `bootstrap` contracts.

Version 0.1 assumes one Native CE workspace/database membership per authenticated
connection. The service must fail safely when membership is ambiguous; the plugin does
not select a workspace or silently choose the first one.

## Repository layout

```text
.agents/plugins/marketplace.json
.claude-plugin/marketplace.json
plugins/native/
├── .codex-plugin/plugin.json
├── .claude-plugin/plugin.json
├── .mcp.json
└── skills/enter/
    ├── SKILL.md
    └── agents/openai.yaml
```

Run the repository checks with:

```sh
python3 scripts/validate.py
```

## License

Except where otherwise noted, the contents of this repository—including JSON and other
formats that do not support comments—are licensed under the [Mozilla Public License
2.0](LICENSE) (`MPL-2.0`).

Copyright © 2026 AI Native Work, Inc.
