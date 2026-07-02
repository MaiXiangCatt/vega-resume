import { CliError } from '../errors'
import { readActiveRequirement, writeRequirement } from '../requirements'
import type { ModuleState, RequirementState } from '../types'

export function assertModuleName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new CliError('Module names may only contain letters, numbers, dots, dashes, and underscores.')
  }
}

function assertFullWorkflow(state: RequirementState): void {
  if (state.workflow !== 'full') {
    throw new CliError('Module commands are only available for full workflow requirements.')
  }
}

function findModule(state: RequirementState, name: string): ModuleState | undefined {
  return state.modules.find((module) => module.name === name)
}

export async function addModule(cwd: string, name: string, now: string): Promise<ModuleState> {
  assertModuleName(name)

  const state = await readActiveRequirement(cwd)
  assertFullWorkflow(state)

  const existingModule = findModule(state, name)

  if (existingModule) {
    return existingModule
  }

  const module: ModuleState = {
    name,
    status: 'pending',
    created_at: now,
    updated_at: now,
  }

  await writeRequirement(cwd, {
    ...state,
    modules: [...state.modules, module],
    updated_at: now,
  })

  return module
}

export async function listModules(cwd: string): Promise<ModuleState[]> {
  const state = await readActiveRequirement(cwd)
  assertFullWorkflow(state)

  return [...state.modules].sort((left, right) => left.name.localeCompare(right.name))
}

export async function getModule(cwd: string, name: string): Promise<ModuleState> {
  assertModuleName(name)

  const state = await readActiveRequirement(cwd)
  assertFullWorkflow(state)

  const module = findModule(state, name)

  if (!module) {
    throw new CliError(`Module "${name}" does not exist.`)
  }

  return module
}

export async function completeModule(cwd: string, name: string, now: string): Promise<ModuleState> {
  assertModuleName(name)

  const state = await readActiveRequirement(cwd)
  assertFullWorkflow(state)

  const module = findModule(state, name)

  if (!module) {
    throw new CliError(`Module "${name}" does not exist.`)
  }

  if (module.status === 'completed') {
    return module
  }

  const completedModule: ModuleState = {
    ...module,
    status: 'completed',
    updated_at: now,
    completed_at: now,
  }

  await writeRequirement(cwd, {
    ...state,
    modules: state.modules.map((candidate) => (candidate.name === name ? completedModule : candidate)),
    updated_at: now,
  })

  return completedModule
}
