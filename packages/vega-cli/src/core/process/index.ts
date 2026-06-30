import { spawn } from 'node:child_process'
import { CliError } from '../errors'
import type { CommandRunnerOptions } from '../types'

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].join(' ')
}

export async function runExternalCommand(
  command: string,
  args: readonly string[],
  options: CommandRunnerOptions,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let failedToStart = false
    const commandText = formatCommand(command, args)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', options.stdout)
    child.stderr?.on('data', options.stderr)

    child.on('error', (error) => {
      failedToStart = true
      reject(new CliError(`Failed to run \`${commandText}\`: ${error.message}`))
    })

    child.on('close', (code, signal) => {
      if (failedToStart) {
        return
      }

      if (code === 0) {
        resolve()
        return
      }

      const reason = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
      reject(new CliError(`Command \`${commandText}\` failed with ${reason}.`))
    })
  })
}
