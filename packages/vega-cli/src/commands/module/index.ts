import type { Command } from 'commander'
import { addModule, completeModule, getModule, listModules } from '../../core/modules'
import { emitJson } from '../../core/output'
import type { CliContext } from '../../core/types'

export function registerModuleCommands(program: Command, context: CliContext): void {
  const moduleCommand = program.command('module').description('manage full workflow modules')

  moduleCommand
    .command('add')
    .argument('<module-name>')
    .description('add a module to the active full workflow requirement')
    .action(async (name: string) => {
      const result = await addModule(context.cwd, name, context.now().toISOString())
      context.stdout(`Module "${result.name}" added.\n`)
    })

  moduleCommand
    .command('list')
    .option('--json', 'print JSON')
    .description('list modules for the active full workflow requirement')
    .action(async (commandOptions: { json?: boolean }) => {
      const modules = await listModules(context.cwd)

      if (commandOptions.json) {
        emitJson(modules, context.stdout)
        return
      }

      for (const moduleState of modules) {
        context.stdout(`${moduleState.name}: ${moduleState.status}\n`)
      }
    })

  moduleCommand
    .command('status')
    .argument('<module-name>')
    .option('--json', 'print JSON')
    .description('print one module status from the active full workflow requirement')
    .action(async (name: string, commandOptions: { json?: boolean }) => {
      const moduleState = await getModule(context.cwd, name)

      if (commandOptions.json) {
        emitJson(moduleState, context.stdout)
        return
      }

      context.stdout(`${moduleState.name}: ${moduleState.status}\n`)
    })

  moduleCommand
    .command('complete')
    .argument('<module-name>')
    .description('mark a module completed on the active full workflow requirement')
    .action(async (name: string) => {
      const moduleState = await completeModule(context.cwd, name, context.now().toISOString())
      context.stdout(`Module "${moduleState.name}" completed.\n`)
    })
}
