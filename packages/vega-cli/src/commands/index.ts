import type { Command } from 'commander'
import { registerDocCommands } from './doc'
import { registerInitCommand } from './init'
import { registerLifecycleCommands } from './lifecycle'
import { registerModuleCommands } from './module'
import { registerRequirementCommands } from './requirement'
import type { CliContext } from '../core/types'

export function registerCommands(program: Command, context: CliContext): void {
  registerInitCommand(program, context)
  registerRequirementCommands(program, context)
  registerDocCommands(program, context)
  registerModuleCommands(program, context)
  registerLifecycleCommands(program, context)
}
