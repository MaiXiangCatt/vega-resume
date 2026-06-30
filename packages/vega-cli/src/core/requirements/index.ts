import { readFile, readdir, writeFile } from 'node:fs/promises'
import { phasesForWorkflow } from '../constants'
import { CliError } from '../errors'
import {
  ensureHarness,
  exists,
  readActiveRequirementName,
  requirementPath,
  requirementsDir,
  writeActiveRequirementName,
} from '../harness'
import type { Phase, PhaseState, RequirementState, RequirementSummary, Workflow } from '../types'

export function assertRequirementName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new CliError('Requirement names may only contain letters, numbers, dots, dashes, and underscores.')
  }
}

export function createRequirementState(name: string, workflow: Workflow, now: string): RequirementState {
  const phases = Object.fromEntries(
    phasesForWorkflow(workflow).map((phase, index) => [
      phase,
      { status: index === 0 ? 'in_progress' : 'pending' },
    ]),
  ) as Partial<Record<Phase, PhaseState>>

  return {
    name,
    workflow,
    status: 'in_progress',
    current_phase: 'init',
    phases,
    documents: {
      prd: null,
      brainstorm: null,
      ...(workflow === 'full' ? { tech_design: null } : {}),
      openspec_dir: null,
    },
    modules: [],
    created_at: now,
    updated_at: now,
  }
}

export async function readRequirement(cwd: string, name: string): Promise<RequirementState> {
  const path = requirementPath(cwd, name)

  if (!(await exists(path))) {
    throw new CliError(`Requirement "${name}" does not exist.`)
  }

  return JSON.parse(await readFile(path, 'utf8')) as RequirementState
}

export async function readActiveRequirement(cwd: string): Promise<RequirementState> {
  return readRequirement(cwd, await readActiveRequirementName(cwd))
}

export async function writeRequirement(cwd: string, state: RequirementState): Promise<void> {
  await writeFile(requirementPath(cwd, state.name), `${JSON.stringify(state, null, 2)}\n`)
}

export function summarizeRequirement(state: RequirementState): RequirementSummary {
  return {
    name: state.name,
    workflow: state.workflow,
    status: state.status,
    current_phase: state.current_phase,
  }
}

export async function listRequirementSummaries(cwd: string): Promise<RequirementSummary[]> {
  await ensureHarness(cwd)
  const entries = await readdir(requirementsDir(cwd))
  const states = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readRequirement(cwd, entry.slice(0, -'.json'.length))),
  )

  return states.map(summarizeRequirement).sort((left, right) => left.name.localeCompare(right.name))
}

export async function initializeRequirement(
  cwd: string,
  name: string,
  workflow: Workflow,
  now: string,
): Promise<RequirementState> {
  assertRequirementName(name)
  await ensureHarness(cwd)

  if (!(await exists(requirementPath(cwd, name)))) {
    await writeRequirement(cwd, createRequirementState(name, workflow, now))
  }

  await writeActiveRequirementName(cwd, name)
  return readRequirement(cwd, name)
}

export async function switchRequirement(cwd: string, name: string): Promise<void> {
  assertRequirementName(name)
  await ensureHarness(cwd)
  await readRequirement(cwd, name)
  await writeActiveRequirementName(cwd, name)
}
