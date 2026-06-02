#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { runVega } from './cli'

export { runVega }

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  runVega(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode
  })
}
