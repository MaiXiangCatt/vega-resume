import { currentPhaseState } from '../state-machine'
import type { OutputWriter, RequirementState } from '../types'

export function emitJson(value: unknown, write: OutputWriter): void {
  write(`${JSON.stringify(value)}\n`)
}

export function emitState(state: RequirementState, json: boolean | undefined, write: OutputWriter): void {
  if (json) {
    emitJson(state, write)
    return
  }

  write(`${state.name}: ${state.current_phase} (${currentPhaseState(state).status})\n`)
}
