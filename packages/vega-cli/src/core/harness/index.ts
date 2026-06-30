import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CliError } from '../errors'

export function harnessDir(cwd: string): string {
  return join(cwd, '.vega-harness')
}

export function requirementsDir(cwd: string): string {
  return join(harnessDir(cwd), 'requirements')
}

export function docsDir(cwd: string): string {
  return join(harnessDir(cwd), 'docs')
}

export function activePath(cwd: string): string {
  return join(harnessDir(cwd), '.active')
}

export function requirementPath(cwd: string, name: string): string {
  return join(requirementsDir(cwd), `${name}.json`)
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function ensureHarness(cwd: string): Promise<void> {
  await mkdir(requirementsDir(cwd), { recursive: true })
  await mkdir(docsDir(cwd), { recursive: true })

  if (!(await exists(activePath(cwd)))) {
    await writeFile(activePath(cwd), '')
  }
}

export async function readActiveRequirementName(cwd: string): Promise<string> {
  await ensureHarness(cwd)
  const active = (await readFile(activePath(cwd), 'utf8')).trim()

  if (!active) {
    throw new CliError('No active requirement. Run `vega requirement init <name>` first.')
  }

  return active
}

export async function writeActiveRequirementName(cwd: string, name: string): Promise<void> {
  await writeFile(activePath(cwd), `${name}\n`)
}
