<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# Native

**Bring your Native workspace into the conversations where work happens.**

Native is a workspace for durable context: current work, decisions, documents and the
relationships between them. The Native plugin lets a supported agent connect to the
workspace you authorise, recover what is current and continue work with you across
conversations.

This repository is Native's first-party plugin catalogue. The `withnative` marketplace
currently exposes two separately installable packages:

- `native@withnative`, packaged in this repository; and
- `surf@withnative`, maintained in [withnative/surf](https://github.com/withnative/surf)
  and fetched from that repository when installed.

Adding the marketplace makes both packages available; it does not install either one.
Install only the package you want. Both are published and maintained by
[Native](https://www.withnative.ai/).

## What Native does

Once connected, Native gives an agent an inspectable source of durable workspace context.
Depending on your request and permissions, the agent can recover current work, find and
summarise records, or create and update workspace content. The hosted service remains the
authoritative source for workspace state and current Native guidance.

## What the plugin installs

The plugin is intentionally small. It adds:

- the `native:enter` skill, which activates Native when you ask to use or set it up; and
- an HTTPS MCP connection to `https://plugin.withnative.ai/mcp`.

It does not install a local executable or shell hooks. It contains no bearer token,
copied workspace data or server implementation. Installing the plugin changes your local
Claude or Codex plugin configuration; it does not by itself read, write or delete
anything in a Native workspace.

## Trust and control

Your client manages Native's OAuth sign-in. You complete authorisation in the window the
client opens; never paste a bearer token into a conversation, plugin file or repository
issue.

Once authorised, Native's tools can access the workspace data available to your account.
The agent uses those tools within your request and the permissions returned by Native.
Installing or activating the plugin does not start autonomous work.

Removing the plugin removes the local skill and connection. It does not delete data held
by Native. Your AI provider still processes the conversation and tool traffic under its
own service terms.

## Install Native

Give this instruction to Claude or ChatGPT/Codex on a supported desktop or CLI client:

```text
Install the native@withnative plugin from https://github.com/withnative/plugins.
You may use the local plugin CLI yourself. Verify the installed package afterwards.
Install it as a plugin, not as a separate standalone MCP connection.
```

The equivalent manual commands are:

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

To install Surf instead, add the same marketplace and select `surf@withnative`. See the
[Surf setup guide](https://github.com/withnative/surf) for its complete installation and
first-use instructions.

Check existing marketplace, plugin and MCP state before adding anything, then verify the
installed plugin. If an existing standalone connection already targets
`https://plugin.withnative.ai/mcp`, explain the overlap and ask before changing it.

For supported surfaces, GUI alternatives, updates, troubleshooting and removal, use the
[complete setup guide](docs/plugin-installation.md).

## After installation

Restart or reload the client if the installation summary asks you to. Restarting ends the
current conversation context; it does not continue an agent in the background.

In a fresh Claude Code conversation, enter Native explicitly with:

```text
/native:enter
```

Or use this ordinary-language prompt on any supported client:

```text
Use Native's quickstart tool to help me finish setting up Native.
```

Your client may open an OAuth sign-in window. After authorisation, the Native entry skill
calls `quickstart` once for first-use guidance and then `bootstrap` to orient the
conversation to your workspace.

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

This repository owns the shared `withnative` marketplace metadata. It also owns the
Native package's stable `/native:enter` activation boundary and remote connection
declaration; Surf's package remains owned by `withnative/surf`. The independently
deployed Native CE service owns OAuth resource-server behaviour, tools, live guidance,
permissions, and durable data. No server implementation, database, workspace facts,
credentials, or copied guide corpus belongs in this catalogue.

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

The two marketplace manifests also reference `plugins/surf` in the separate
`withnative/surf` repository. That entry tracks its `main` branch. Every Surf release
must increment the version in both of Surf's plugin manifests before merging so hosts
store and load it as a new versioned package.

Run the repository checks with:

```sh
python3 scripts/validate.py
```

## Command-based MCP clients

Clients that support only command-based stdio MCP servers can use the separately versioned
[`@withnative/mcp-stdio`](packages/mcp-stdio/README.md) compatibility package. It routes to
the same hosted Native MCP and keeps every marketplace manifest HTTP-only. Documentation and
configuration pin an exact package version.

## License

Except where otherwise noted, the contents of this repository—including JSON and other
formats that do not support comments—are licensed under the [Mozilla Public License
2.0](LICENSE) (`MPL-2.0`).

Copyright © 2026 AI Native Work, Inc.
