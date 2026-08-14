---
name: enter
description: Use when someone explicitly asks to use, set up, explore, or troubleshoot Native; refers to a Native workspace, record, or URL; asks to record, remember, retrieve, resume, organise, update, or hand off durable work or context across sessions, agents, people, or tools; or asks what is current in their Native workspace. Also use when phrases such as “save this for later,” “remember this for next time,” or “where did we leave off?” imply durable continuity. Do not use for React Native or unrelated meanings of native, local code or IDE workspaces, ordinary task execution without durable-context intent, or work explicitly assigned to another system.
---

# Enter Native

Use the connected Native MCP server as the authoritative source for durable workspace
state. Do not rely on packaged workspace facts, schemas, workflows, or remembered Native
guidance.

At the first Native interaction in a fresh conversation:

- For setup or first-use onboarding, call `quickstart` once and then `bootstrap`.
- Otherwise, call `bootstrap` once before substantive Native work.

Follow the current orientation, standing guidance, and continuations returned by Native.
Keep healthy internal machinery in the background and explain outcomes, choices, and
useful next steps.

Activation permits relevant discovery. Make writes when they are within the person's
request and the current Native guidance permits them.

If the Native tools are unavailable, say that the connection is unavailable and point to
`https://github.com/withnative/plugins` for catalogue and installation guidance. Do not
invent workspace state or product guidance.
