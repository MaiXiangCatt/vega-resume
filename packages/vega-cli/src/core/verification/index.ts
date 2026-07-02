import { phasesForWorkflow } from '../constants'
import type {
  ModuleState,
  ModuleStatus,
  Phase,
  PhaseState,
  PhaseStatus,
  RequirementState,
  RequirementStatus,
  VerifyPayload,
  Workflow,
} from '../types'

const workflows = new Set<Workflow>(['lite', 'full'])
const requirementStatuses = new Set<RequirementStatus>(['in_progress', 'completed'])
const phaseStatuses = new Set<PhaseStatus>(['pending', 'in_progress', 'completed', 'failed'])
const moduleStatuses = new Set<ModuleStatus>(['pending', 'completed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validatePhase(
  phase: Phase,
  value: PhaseState | undefined,
  currentPhase: Phase,
  errors: string[],
): void {
  if (!value) {
    errors.push(`Missing phase "${phase}".`)
    return
  }

  if (!phaseStatuses.has(value.status)) {
    errors.push(`Phase "${phase}" has invalid status "${String(value.status)}".`)
    return
  }

  if (value.status === 'failed' && phase !== currentPhase) {
    errors.push(`Only the current phase may be failed, but "${phase}" is failed.`)
  }
}

function validateModules(state: RequirementState, errors: string[]): void {
  if (!Array.isArray(state.modules)) {
    errors.push('Modules must be an array.')
    return
  }

  if (state.workflow === 'lite' && state.modules.length > 0) {
    errors.push('Lite workflow requirements must not contain modules.')
  }

  const names = new Set<string>()

  for (const moduleState of state.modules as ModuleState[]) {
    if (!isRecord(moduleState)) {
      errors.push('Each module must be an object.')
      continue
    }

    if (typeof moduleState.name !== 'string' || !moduleState.name) {
      errors.push('Each module must have a non-empty name.')
      continue
    }

    if (names.has(moduleState.name)) {
      errors.push(`Duplicate module "${moduleState.name}".`)
    }

    names.add(moduleState.name)

    if (!moduleStatuses.has(moduleState.status)) {
      errors.push(`Module "${moduleState.name}" has invalid status "${String(moduleState.status)}".`)
    }
  }
}

export function verifyRequirementState(state: RequirementState): VerifyPayload {
  const errors: string[] = []

  if (!state.name) {
    errors.push('Requirement name is missing.')
  }

  if (!workflows.has(state.workflow)) {
    errors.push(`Invalid workflow "${String(state.workflow)}".`)
    return { valid: false, errors }
  }

  if (!requirementStatuses.has(state.status)) {
    errors.push(`Invalid requirement status "${String(state.status)}".`)
  }

  const workflowPhases = phasesForWorkflow(state.workflow)

  if (!workflowPhases.includes(state.current_phase)) {
    errors.push(`Current phase "${String(state.current_phase)}" is not part of the ${state.workflow} workflow.`)
  }

  if (!isRecord(state.phases)) {
    errors.push('Phases must be an object.')
    return { valid: false, errors }
  }

  for (const phase of workflowPhases) {
    validatePhase(phase, state.phases[phase], state.current_phase, errors)
  }

  for (const phase of Object.keys(state.phases)) {
    if (!workflowPhases.includes(phase as Phase)) {
      errors.push(`Unexpected phase "${phase}" for ${state.workflow} workflow.`)
    }
  }

  const inProgressPhases = workflowPhases.filter((phase) => state.phases[phase]?.status === 'in_progress')

  if (state.status === 'completed') {
    const incompletePhases = workflowPhases.filter((phase) => state.phases[phase]?.status !== 'completed')

    if (incompletePhases.length > 0) {
      errors.push(`Completed requirement still has incomplete phases: ${incompletePhases.join(', ')}.`)
    }
  } else if (state.phases[state.current_phase]?.status === 'failed') {
    if (inProgressPhases.length > 0) {
      errors.push('Failed requirements must not have another in-progress phase.')
    }
  } else if (inProgressPhases.length !== 1 || inProgressPhases[0] !== state.current_phase) {
    errors.push('In-progress requirements must have exactly one in-progress phase matching current_phase.')
  }

  if (!isRecord(state.documents)) {
    errors.push('Documents must be an object.')
  }

  validateModules(state, errors)

  return {
    valid: errors.length === 0,
    errors,
  }
}
