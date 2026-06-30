import type { Command } from 'commander'
import { ensureHarness } from '../../core/harness'
import { installVegaSkills } from '../../core/skills'
import type { CliContext } from '../../core/types'

export function registerInitCommand(program: Command, context: CliContext): void {
  program
    .command('init')
    .description('initialize .vega-harness directories')
    .action(async () => {
      await ensureHarness(context.cwd)
      context.stdout('Initialized .vega-harness\n')
      context.stdout('Installing Vega skills...\n')
      await installVegaSkills(context.cwd, context.commandRunner, context.stdout, context.stderr)
      context.stdout('Installed Vega skills.\n')
    })
}
