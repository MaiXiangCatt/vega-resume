import type { Phase, Workflow } from '../types'

export const litePhases: Phase[] = [
  'init',
  'brainstorm',
  'openspec',
  'implementation',
  'verification',
  'archive',
]

export const fullPhases: Phase[] = [
  'init',
  'brainstorm',
  'tech_design',
  'breakdown',
  'openspec',
  'implementation',
  'verification',
  'archive',
]

export const skillByPhase: Record<Phase, string> = {
  init: 'vega-requirement-init',
  brainstorm: 'vega-brainstorm',
  tech_design: 'vega-tech-design',
  breakdown: 'vega-breakdown',
  openspec: 'vega-openspec',
  implementation: 'vega-implementation',
  verification: 'vega-verification',
  archive: 'vega-archive',
}

export function phasesForWorkflow(workflow: Workflow): Phase[] {
  return workflow === 'full' ? fullPhases : litePhases
}
