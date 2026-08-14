<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# Install and manage the Native plugin

This is the canonical guide for installing, updating, removing, and recovering Native on
its supported plugin surfaces.

## Start with the repository link

Paste this into Claude or ChatGPT/Codex, on desktop or CLI:

```text
Open https://github.com/withnative/plugins and follow the setup guide for the Native plugin.
```

### For agents following this guide

Inspect the local marketplace, plugin and MCP state before deciding installation is
unavailable. If shell access is available, perform the setup yourself with the client's
non-interactive plugin CLI below. Do not substitute a curated plugin-catalogue search for
the repository the user supplied, and do not send the user to interactive slash commands
when you can run the non-interactive CLI.

Ask before changing an existing standalone Native MCP connection. Verify the installed
plugin afterwards and follow any reload or restart instruction reported by the client. If
the current conversation cannot load the newly installed plugin, give the user this
copyable continuation prompt before ending:

```text
Use Native's quickstart tool to help me finish setting up Native.
```

If you are on mobile, in a browser-only chat, or on another unlisted surface, use a
supported desktop or CLI client instead; the plugin flow is not verified there.

## ChatGPT/Codex Desktop

The Codex CLI installs Native in two commands. The install verb is `add`, not `install`:

```sh
codex plugin marketplace add withnative/plugins
codex plugin add native@withnative
```

Confirm the result with `codex plugin list`, then restart ChatGPT/Codex Desktop.

To install in-product instead:

1. In a terminal, add the public repository marketplace:

   ```sh
   codex plugin marketplace add withnative/plugins
   ```

2. Restart ChatGPT/Codex Desktop.
3. In Work or Codex mode, open **Plugins Directory**.
4. Select the **Native** source, open **Native**, and choose **Install**.

Choose one route per host. The CLI and desktop app share the same Codex configuration, so
installing with both routes can produce duplicate skills and tools.

Start a new conversation and say
`Use Native's quickstart tool to help me finish setting up Native.` You can invoke Native
explicitly as `@native`, select `$enter` where the client exposes skill selectors, or make
an ordinary request such as `What is current in my Native workspace?`

## Claude Code

The Claude CLI installs Native in two commands. The default scope is `user`:

```sh
claude plugin marketplace add withnative/plugins
claude plugin install native@withnative
```

Confirm the result with `claude plugin list`. Restart the desktop application, or run
`/reload-plugins` in a Claude Code terminal session if the installation summary asks for
it. The equivalent interactive commands are:

```text
/plugin marketplace add withnative/plugins
/plugin install native@withnative
```

Start a new conversation and say
`Use Native's quickstart tool to help me finish setting up Native.` To invoke the entry
skill explicitly, use `/native:enter`.

## Authentication and first use

The installed plugin supplies Native's entry skill and an authenticated connection to
`https://plugin.withnative.ai/mcp`. The host owns the OAuth flow. Complete sign-in in the
window it opens; never paste a bearer token into a conversation, command, plugin file, or
repository issue.

For first-use onboarding, the entry skill calls `quickstart` once and then `bootstrap`.
For later conversations it calls `bootstrap` before substantive Native work. Version 0.1
assumes exactly one Native CE workspace/database membership per authenticated connection;
ambiguous membership fails safely rather than selecting one silently.

## Updates

For ChatGPT/Codex Desktop, refresh the marketplace snapshot and reinstall:

```sh
codex plugin marketplace upgrade withnative
codex plugin remove native@withnative
codex plugin add native@withnative
```

For Claude Code, refresh the marketplace and reinstall:

```sh
claude plugin marketplace update withnative
claude plugin uninstall native@withnative
claude plugin install native@withnative
```

Restart or reload the client after a package update and begin a new conversation.

## Uninstall

For ChatGPT/Codex Desktop:

```sh
codex plugin remove native@withnative
```

For Claude Code:

```sh
claude plugin uninstall native@withnative
```

To stop tracking the whole Native marketplace as well, run
`codex plugin marketplace remove withnative` or
`claude plugin marketplace remove withnative` for the relevant client. Removing the
plugin removes its packaged skill and connection; it does not delete data held by Native.

## Recovery and troubleshooting

If Native is absent after installation:

- Confirm `https://github.com/withnative/plugins` is publicly reachable.
- Confirm the package appears in `codex plugin list` or `claude plugin list`.
- Restart ChatGPT/Codex Desktop, or reload/restart Claude Code.
- Inspect the client's MCP controls and confirm the plugin-provided `native` server is
  enabled and connected.
- Confirm `https://plugin.withnative.ai/mcp` is reachable from the client environment.
- Start a new conversation after installation or update.

If a standalone connection already targets exactly `https://plugin.withnative.ai/mcp`, it
may duplicate the connection supplied by the plugin. Do not remove or rewrite it
automatically. Identify the exact entry, explain the overlap, ask before changing it, and
verify that the plugin-provided connection still works after any approved cleanup.

If Native's tools remain unavailable, do not invent workspace state or continue from
remembered guidance. Report that the connection is unavailable and return to these
installation checks.

These routes are supported only on the named desktop and CLI surfaces. Browser-only and
mobile clients must be verified on the specific account and client before support is
claimed.

## jcode and other stdio-only clients

jcode reads command-based entries from `~/.jcode/mcp.json` or `.jcode/mcp.json` and skips
HTTP/SSE entries. Use the independently versioned adapter rather than changing the marketplace
plugin:

```json
{
  "mcpServers": {
    "native": {
      "command": "npx",
      "args": ["-y", "@withnative/mcp-stdio@0.1.0"],
      "env": {},
      "shared": true
    }
  }
}
```

See [`packages/mcp-stdio/README.md`](../packages/mcp-stdio/README.md) for pre-auth,
credential removal, fixed-port SSH forwarding, and adapter troubleshooting. The adapter
still reaches the hosted Native service; it does not install a second tool set.
