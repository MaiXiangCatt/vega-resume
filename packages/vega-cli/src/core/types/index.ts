export type Workflow = 'lite' | 'full'

export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export type RequirementStatus = 'in_progress' | 'completed'

export type Phase =
  | 'init'
  | 'brainstorm'
  | 'tech_design'
  | 'breakdown'
  | 'openspec'
  | 'implementation'
  | 'verification'
  | 'archive'

export interface PhaseState {
  status: PhaseStatus
  completed_at?: string
  failed_at?: string
  failed_reason?: string
}

export interface RequirementState {
  name: string
  workflow: Workflow
  status: RequirementStatus
  current_phase: Phase
  phases: Partial<Record<Phase, PhaseState>>
  documents: Record<string, string | null>
  modules: unknown[]
  created_at: string
  updated_at: string
}

export interface RequirementSummary {
  name: string
  workflow: Workflow
  status: RequirementStatus
  current_phase: Phase
}

export interface NextPayload {
  requirement: string
  workflow: Workflow
  phase: Phase
  status: PhaseStatus
  skill: string | null
  done: boolean
}

export type OutputWriter = (value: string) => void

export interface CommandRunnerOptions {
  cwd: string
  stdout: OutputWriter
  stderr: OutputWriter
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: CommandRunnerOptions,
) => Promise<void>

export interface RunOptions {
  cwd?: string
  now?: () => Date
  stdout?: OutputWriter
  stderr?: OutputWriter
  commandRunner?: CommandRunner
}

export interface CliContext {
  cwd: string
  now: () => Date
  stdout: OutputWriter
  stderr: OutputWriter
  commandRunner: CommandRunner
}
