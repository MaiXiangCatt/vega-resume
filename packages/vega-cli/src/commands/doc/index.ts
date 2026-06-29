import type { Command } from 'commander'
import { getDocumentPath, setDocumentPath } from '../../core/documents'
import { CliError } from '../../core/errors'
import { emitJson } from '../../core/output'
import type { CliContext } from '../../core/types'

export function registerDocCommands(program: Command, context: CliContext): void {
  const doc = program.command('doc').description('manage requirement document references')

  doc
    .command('set')
    .argument('<type>')
    .argument('<path>')
    .description('associate a document path with the active requirement')
    .action(async (type: string, artifactPath: string) => {
      const result = await setDocumentPath(context.cwd, type, artifactPath, context.now().toISOString())
      context.stdout(`Document "${result.type}" set to "${result.path}".\n`)
    })

  doc
    .command('get')
    .argument('<type>')
    .option('--json', 'print JSON')
    .description('print a document path from the active requirement')
    .action(async (type: string, commandOptions: { json?: boolean }) => {
      const result = await getDocumentPath(context.cwd, type)

      if (commandOptions.json) {
        emitJson(result, context.stdout)
        return
      }

      if (!result.path) {
        throw new CliError(`No document path set for type "${result.type}".`)
      }

      context.stdout(`${result.path}\n`)
    })
}
