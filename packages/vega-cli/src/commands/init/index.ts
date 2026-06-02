import type { Command } from 'commander'
import { ensureHarness } from '../../core/harness'
import type { CliContext } from '../../core/types'

export function registerInitCommand(program: Command, context: CliContext): void {
  program
    .command('init')
    .description('initialize .vega-harness directories')
    .action(async () => {
      await ensureHarness(context.cwd)
    })
}
