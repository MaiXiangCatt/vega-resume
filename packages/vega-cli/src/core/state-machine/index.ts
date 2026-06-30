import { phasesForWorkflow, skillByPhase } from '../constants'
import { CliError } from '../errors'
import type { NextPayload, PhaseState, RequirementState } from '../types'

function skillForCurrentPhase(state: RequirementState, phaseState: PhaseState): string | null {
  if (state.status === 'completed') {
    return null
  }

  if (phaseState.status === 'failed') {
    return 'vega-experience'
  }

  return skillByPhase[state.current_phase]
}

export function currentPhaseState(state: RequirementState): PhaseState {
  const phase = state.phases[state.current_phase]

  if (!phase) {
    throw new CliError(`State file is missing current phase "${state.current_phase}".`)
  }

  return phase
}

export function getNextPayload(state: RequirementState): NextPayload {
  const phaseState = currentPhaseState(state)
  const done = state.status === 'completed'

  return {
    requirement: state.name,
    workflow: state.workflow,
    phase: state.current_phase,
    status: phaseState.status,
    skill: skillForCurrentPhase(state, phaseState),
    done,
  }
}

export function completeCurrentPhase(state: RequirementState, now: string): RequirementState {
  if (state.status === 'completed') {
    return state
  }

  const phaseState = currentPhaseState(state)

  if (phaseState.status === 'failed') {
    throw new CliError(`Current phase "${state.current_phase}" is failed. Run \`vega retry\` before completing it.`)
  }

  if (phaseState.status !== 'in_progress') {
    throw new CliError(`Current phase "${state.current_phase}" is not in progress.`)
  }

  const phases = {
    ...state.phases,
    [state.current_phase]: {
      ...phaseState,
      status: 'completed' as const,
      completed_at: now,
    },
  }

  const workflowPhases = phasesForWorkflow(state.workflow)
  const index = workflowPhases.indexOf(state.current_phase)
  const nextPhase = workflowPhases[index + 1]

  if (!nextPhase) {
    return {
      ...state,
      status: 'completed',
      phases,
      updated_at: now,
    }
  }

  return {
    ...state,
    current_phase: nextPhase,
    phases: {
      ...phases,
      [nextPhase]: { status: 'in_progress' },
    },
    updated_at: now,
  }
}

export function failCurrentPhase(state: RequirementState, now: string, reason?: string): RequirementState {
  if (state.status === 'completed') {
    throw new CliError('Completed requirements cannot be marked failed.')
  }

  const phaseState = currentPhaseState(state)

  return {
    ...state,
    phases: {
      ...state.phases,
      [state.current_phase]: {
        ...phaseState,
        status: 'failed',
        failed_at: now,
        ...(reason ? { failed_reason: reason } : {}),
      },
    },
    updated_at: now,
  }
}

export function retryCurrentPhase(state: RequirementState, now: string): RequirementState {
  const phaseState = currentPhaseState(state)

  if (phaseState.status !== 'failed') {
    throw new CliError(`Current phase "${state.current_phase}" is not failed.`)
  }

  const { failed_at: _failedAt, failed_reason: _failedReason, ...phaseWithoutFailure } = phaseState

  return {
    ...state,
    phases: {
      ...state.phases,
      [state.current_phase]: {
        ...phaseWithoutFailure,
        status: 'in_progress',
      },
    },
    updated_at: now,
  }
}
