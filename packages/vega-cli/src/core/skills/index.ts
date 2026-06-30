import type { CommandRunner, OutputWriter } from '../types'

export const vegaSkillInstallCommand = {
  command: 'npx',
  args: ['skills', 'add', 'MaiXiangCatt/vega-resume', '--skill', '*'],
} as const

export async function installVegaSkills(
  cwd: string,
  runCommand: CommandRunner,
  stdout: OutputWriter,
  stderr: OutputWriter,
): Promise<void> {
  await runCommand(vegaSkillInstallCommand.command, vegaSkillInstallCommand.args, {
    cwd,
    stdout,
    stderr,
  })
}
