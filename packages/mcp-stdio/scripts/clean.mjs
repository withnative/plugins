/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { rm } from 'node:fs/promises'
await rm(new URL('../dist', import.meta.url), { force: true, recursive: true })
