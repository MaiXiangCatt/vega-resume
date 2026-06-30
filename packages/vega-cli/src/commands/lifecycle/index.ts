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
    const previousPhase = state.current_phase
    const nextState = completeCurrentPhase(state, context.now().toISOString())

    await writeRequirement(context.cwd, nextState)

    if (nextState.status === 'completed') {
      context.stdout(`Completed phase "${previousPhase}"; requirement "${nextState.name}" is done.\n`)
      return
    }

    context.stdout(`Completed phase "${previousPhase}"; next phase is "${nextState.current_phase}".\n`)
  })

  program.command('archive').action(async () => {
    const state = await readActiveRequirement(context.cwd)

    if (state.status === 'completed') {
      context.stdout(`Requirement "${state.name}" is already archived.\n`)
      return
    }

    if (state.current_phase !== 'archive') {
      throw new CliError('Archive can only complete a requirement that is already in the archive phase.')
    }

    const nextState = completeCurrentPhase(state, context.now().toISOString())

    await writeRequirement(context.cwd, nextState)
    context.stdout(`Archived requirement "${nextState.name}".\n`)
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
      context.stdout(`Marked phase "${state.current_phase}" as failed.\n`)
    })

  program.command('retry').action(async () => {
    const state = await readActiveRequirement(context.cwd)
    await writeRequirement(context.cwd, retryCurrentPhase(state, context.now().toISOString()))
    context.stdout(`Retried phase "${state.current_phase}"; status is in_progress.\n`)
  })
}
