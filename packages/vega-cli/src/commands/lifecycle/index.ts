import type { Command } from 'commander'
import { CliError } from '../../core/errors'
import { emitJson } from '../../core/output'
import { readActiveRequirement, writeRequirement } from '../../core/requirements'
import {
  completeCurrentPhase,
  failCurrentPhase,
  getNextPayload,
  retryCurrentPhase,
} from '../../core/state-machine'
import type { CliContext } from '../../core/types'

export function registerLifecycleCommands(program: Command, context: CliContext): void {
  program
    .command('next')
    .option('--json', 'print JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      const payload = getNextPayload(await readActiveRequirement(context.cwd))

      if (commandOptions.json) {
        emitJson(payload, context.stdout)
        return
      }

      context.stdout(payload.done ? 'done\n' : `${payload.skill}\n`)
    })

  program.command('complete').action(async () => {
    const state = await readActiveRequirement(context.cwd)
    await writeRequirement(context.cwd, completeCurrentPhase(state, context.now().toISOString()))
  })

  program.command('archive').action(async () => {
    const state = await readActiveRequirement(context.cwd)

    if (state.status === 'completed') {
      return
    }

    if (state.current_phase !== 'archive') {
      throw new CliError('Archive can only complete a requirement that is already in the archive phase.')
    }

    await writeRequirement(context.cwd, completeCurrentPhase(state, context.now().toISOString()))
  })

  program
    .command('fail')
    .option('--reason <reason>', 'failure reason')
    .action(async (commandOptions: { reason?: string }) => {
      const state = await readActiveRequirement(context.cwd)
      await writeRequirement(
        context.cwd,
        failCurrentPhase(state, context.now().toISOString(), commandOptions.reason),
      )
    })

  program.command('retry').action(async () => {
    const state = await readActiveRequirement(context.cwd)
    await writeRequirement(context.cwd, retryCurrentPhase(state, context.now().toISOString()))
  })
}
