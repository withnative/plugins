#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { run } from '../runner.js'
process.exitCode = await run('proxy')
