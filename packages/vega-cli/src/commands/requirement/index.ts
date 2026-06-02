import type { Command } from 'commander'
import { readActiveRequirementName } from '../../core/harness'
import { emitJson, emitState } from '../../core/output'
import {
  initializeRequirement,
  listRequirementSummaries,
  readActiveRequirement,
  switchRequirement,
} from '../../core/requirements'
import type { CliContext, Workflow } from '../../core/types'
import { CliError } from '../../core/errors'

function parseWorkflow(value: string): Workflow {
  if (value !== 'lite' && value !== 'full') {
    throw new CliError('Workflow must be either "lite" or "full".')
  }

  return value
}

export function registerRequirementCommands(program: Command, context: CliContext): void {
  const requirement = program.command('requirement').description('manage requirement state')

  requirement
    .command('init')
    .argument('<name>')
    .option('--workflow <workflow>', 'workflow type: lite or full', 'lite')
    .action(async (name: string, commandOptions: { workflow: string }) => {
      await initializeRequirement(context.cwd, name, parseWorkflow(commandOptions.workflow), context.now().toISOString())
    })

  requirement
    .command('status')
    .option('--json', 'print JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      emitState(await readActiveRequirement(context.cwd), commandOptions.json, context.stdout)
    })

  requirement
    .command('current')
    .option('--json', 'print JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      const current = await readActiveRequirementName(context.cwd)

      if (commandOptions.json) {
        emitJson({ current }, context.stdout)
        return
      }

      context.stdout(`${current}\n`)
    })

  requirement
    .command('list')
    .option('--json', 'print JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      const states = await listRequirementSummaries(context.cwd)

      if (commandOptions.json) {
        emitJson(states, context.stdout)
        return
      }

      for (const state of states) {
        context.stdout(`${state.name}: ${state.current_phase} (${state.status})\n`)
      }
    })

  requirement
    .command('switch')
    .argument('<name>')
    .action(async (name: string) => {
      await switchRequirement(context.cwd, name)
    })
}
