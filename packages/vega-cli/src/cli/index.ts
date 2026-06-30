import { Command, CommanderError } from 'commander'
import { registerCommands } from '../commands'
import { CliError } from '../core/errors'
import type { CliContext, RunOptions } from '../core/types'

export function buildProgram(context: CliContext): Command {
  const program = new Command()

  program
    .name('vega')
    .exitOverride()
    .configureOutput({
      writeOut: context.stdout,
      writeErr: context.stderr,
    })

  registerCommands(program, context)

  return program
}

export async function runVega(args: string[], runOptions: RunOptions = {}): Promise<number> {
  const context: CliContext = {
    cwd: runOptions.cwd ?? process.cwd(),
    now: runOptions.now ?? (() => new Date()),
    stdout: runOptions.stdout ?? ((value) => process.stdout.write(value)),
    stderr: runOptions.stderr ?? ((value) => process.stderr.write(value)),
  }

  try {
    await buildProgram(context).parseAsync(args, { from: 'user' })
    return 0
  } catch (error) {
    if (error instanceof CliError) {
      context.stderr(`Error: ${error.message}\n`)
      return error.exitCode
    }

    if (error instanceof CommanderError) {
      return error.exitCode
    }

    throw error
  }
}
