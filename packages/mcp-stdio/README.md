<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->
# `@withnative/mcp-stdio`

This command-based adapter lets stdio-only clients such as jcode connect to the same live
tools at `https://plugin.withnative.ai/mcp`. It copies no Native tools, data, or server logic.

```sh
npx -y @withnative/mcp-stdio@0.1.0
```

Node.js 22+ is required. The package pins exact `mcp-remote@0.1.38`, HTTP-only transport,
Native public-client metadata, S256 authorization code, and conservative scopes.

## jcode

Add to `~/.jcode/mcp.json` or `.jcode/mcp.json`:

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

Pre-authorize or diagnose outside jcode with:

```sh
npx -y --package @withnative/mcp-stdio@0.1.0 mcp-stdio-auth
```

Do not interrupt the first authorization until stderr shows `Connected successfully!`
followed by a `Received message:` tools result. Those are the observable success markers:
the dynamic client registration and tokens have been persisted and hardened by then. Exact
`mcp-remote@0.1.38` remains open after that successful response because its diagnostic client
replaces the SDK response handler before its request promise can finish. Press **Ctrl-C once,
only after those markers**; the wrapper forwards SIGINT, the pinned client cleans up, and the
command exits normally. This wait is an exact-pin limitation, not a failed authorization.

Complete this pre-authorization once before starting several fresh clients at the same
time. Concurrent ordinary starts reuse the stored registration and tokens. The pinned
upstream can race if multiple processes independently attempt the very first browser/DCR
flow; stop them, run `mcp-stdio-auth` once, then restart the clients.

## State and removal

Private state lives at `~/Library/Application Support/Native/mcp-stdio/` on macOS,
`${XDG_CONFIG_HOME:-~/.config}/native/mcp-stdio/` on Linux, or
`%LOCALAPPDATA%\\Native\\mcp-stdio\\` on Windows. Set `NATIVE_MCP_STDIO_CONFIG_DIR` to an
absolute path to override it. Directories are `0700`; credential files are `0600`.

Removing that directory signs out locally and causes re-registration. It does not remove
the AuthKit application; an operator must separately revoke that client in WorkOS Connect.
Short-lived access tokens may remain usable until expiry.

## Fixed-port SSH flow

On the browser machine, forward a chosen port to the remote host:

```sh
ssh -N -L 38191:127.0.0.1:38191 remote.example.com
```

Then on the remote host run:

```sh
npx -y --package @withnative/mcp-stdio@0.1.0 \
  mcp-stdio-auth --callback-port 38191 --auth-timeout 300
```

Open the printed URL locally if necessary and keep the tunnel until callback completion.
Wait for the same connected/tools-result success markers before pressing Ctrl-C.
Use the same `--callback-port 38191` arguments in jcode afterwards.

## Troubleshooting

- Use `mcp-stdio-auth` to separate OAuth from stdio/process errors.
- `--debug` writes sensitive authentication diagnostics; review and redact before sharing.
- Changing callback port or upstream storage version may require reauthorization.
- The marketplace plugin remains an HTTP integration; this is only a stdio compatibility package.

Device authorization and OS-keychain storage are deferred from 0.1.0.
