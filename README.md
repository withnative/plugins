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

## Start here

- **Setting up Native?** [Follow the setup guide](docs/plugin-installation.md).
- **Understanding how it is delivered?** Read [the architecture](#architecture).
- **Inspecting the catalogue?** See [the repository layout](#repository-layout) and
  [validation command](#repository-layout).

## Quickstart for humans

Give this instruction to Claude or ChatGPT/Codex, on desktop or CLI:

```text
Open https://github.com/withnative/plugins and follow the setup guide for the Native plugin.
```

The agent should identify the client it is running in, install Native using that client's
plugin tools and explain any required restart or reload.

If installation requires a reload or restart, continue in a fresh conversation with:

```text
Use Native's quickstart tool to help me finish setting up Native.
```

For manual installation, supported surfaces, updates, troubleshooting and removal, use
the [setup guide](docs/plugin-installation.md).

## Quickstart for agents

If a user asks you to set up Native from this repository, inspect the local client before
deciding installation is unavailable. If shell access is available, perform the setup
yourself using the client's non-interactive plugin CLI.

**Claude Code and its desktop application:**

```sh
claude plugin marketplace add withnative/plugins
claude plugin install native@withnative
```

**ChatGPT/Codex Desktop and Codex CLI:**

```sh
codex plugin marketplace add withnative/plugins
codex plugin add native@withnative
```

Check existing marketplace, plugin and MCP state before adding anything. Verify the
installed plugin afterwards and follow any restart or reload instruction reported by the
client.

Do not substitute a curated plugin-catalogue search for the repository the user supplied.
Do not send the user to interactive slash commands when you have shell access to the
non-interactive CLI.

If installation requires a restart or reload, give the user this copyable continuation
prompt before ending the conversation:

```text
Use Native's quickstart tool to help me finish setting up Native.
```

For existing installations, duplicate MCP connections, GUI alternatives, updates,
troubleshooting and removal, follow the
[complete setup guide](docs/plugin-installation.md).

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
