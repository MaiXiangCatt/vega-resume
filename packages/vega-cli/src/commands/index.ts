import type { Command } from 'commander'
import { registerInitCommand } from './init'
import { registerLifecycleCommands } from './lifecycle'
import { registerRequirementCommands } from './requirement'
import type { CliContext } from '../core/types'

export function registerCommands(program: Command, context: CliContext): void {
  registerInitCommand(program, context)
  registerRequirementCommands(program, context)
  registerLifecycleCommands(program, context)
}
