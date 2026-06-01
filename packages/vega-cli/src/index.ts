#!/usr/bin/env node
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Command, CommanderError } from 'commander'

type Workflow = 'lite' | 'full'
type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'failed'
type RequirementStatus = 'in_progress' | 'completed'

type Phase =
  | 'init'
  | 'brainstorm'
  | 'tech_design'
  | 'breakdown'
  | 'openspec'
  | 'implementation'
  | 'verification'
  | 'archive'

interface PhaseState {
  status: PhaseStatus
  completed_at?: string
  failed_at?: string
  failed_reason?: string
}

interface RequirementState {
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

interface RunOptions {
  cwd?: string
  now?: () => Date
  stdout?: (value: string) => void
  stderr?: (value: string) => void
}

const litePhases: Phase[] = [
  'init',
  'brainstorm',
  'openspec',
  'implementation',
  'verification',
  'archive',
]

const fullPhases: Phase[] = [
  'init',
  'brainstorm',
  'tech_design',
  'breakdown',
  'openspec',
  'implementation',
  'verification',
  'archive',
]

const skillByPhase: Record<Phase, string> = {
  init: 'vega-requirement-init',
  brainstorm: 'vega-brainstorm',
  tech_design: 'vega-tech-design',
  breakdown: 'vega-breakdown',
  openspec: 'vega-openspec',
  implementation: 'vega-implementation',
  verification: 'vega-verification',
  archive: 'vega-archive',
}

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message)
  }
}

function phasesForWorkflow(workflow: Workflow) {
  return workflow === 'full' ? fullPhases : litePhases
}

function harnessDir(cwd: string) {
  return join(cwd, '.vega-harness')
}

function requirementsDir(cwd: string) {
  return join(harnessDir(cwd), 'requirements')
}

function docsDir(cwd: string) {
  return join(harnessDir(cwd), 'docs')
}

function activePath(cwd: string) {
  return join(harnessDir(cwd), '.active')
}

function requirementPath(cwd: string, name: string) {
  return join(requirementsDir(cwd), `${name}.json`)
}

function assertRequirementName(name: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new CliError('Requirement names may only contain letters, numbers, dots, dashes, and underscores.')
  }
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function ensureHarness(cwd: string) {
  await mkdir(requirementsDir(cwd), { recursive: true })
  await mkdir(docsDir(cwd), { recursive: true })

  if (!(await exists(activePath(cwd)))) {
    await writeFile(activePath(cwd), '')
  }
}

function createRequirementState(name: string, workflow: Workflow, now: string): RequirementState {
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

async function readActiveRequirementName(cwd: string) {
  await ensureHarness(cwd)
  const active = (await readFile(activePath(cwd), 'utf8')).trim()

  if (!active) {
    throw new CliError('No active requirement. Run `vega requirement init <name>` first.')
  }

  return active
}

async function readRequirement(cwd: string, name: string) {
  const path = requirementPath(cwd, name)

  if (!(await exists(path))) {
    throw new CliError(`Requirement "${name}" does not exist.`)
  }

  return JSON.parse(await readFile(path, 'utf8')) as RequirementState
}

async function readActiveRequirement(cwd: string) {
  return readRequirement(cwd, await readActiveRequirementName(cwd))
}

async function writeRequirement(cwd: string, state: RequirementState) {
  await writeFile(requirementPath(cwd, state.name), `${JSON.stringify(state, null, 2)}\n`)
}

function currentPhaseState(state: RequirementState) {
  const phase = state.phases[state.current_phase]

  if (!phase) {
    throw new CliError(`State file is missing current phase "${state.current_phase}".`)
  }

  return phase
}

function emitJson(value: unknown, write: (value: string) => void) {
  write(`${JSON.stringify(value)}\n`)
}

function emitState(state: RequirementState, json: boolean | undefined, write: (value: string) => void) {
  if (json) {
    emitJson(state, write)
    return
  }

  write(`${state.name}: ${state.current_phase} (${currentPhaseState(state).status})\n`)
}

function summarizeRequirement(state: RequirementState) {
  return {
    name: state.name,
    workflow: state.workflow,
    status: state.status,
    current_phase: state.current_phase,
  }
}

function getNextPayload(state: RequirementState) {
  const phaseState = currentPhaseState(state)
  const done = state.status === 'completed'

  return {
    requirement: state.name,
    workflow: state.workflow,
    phase: state.current_phase,
    status: phaseState.status,
    skill: done ? null : phaseState.status === 'failed' ? 'vega-experience' : skillByPhase[state.current_phase],
    done,
  }
}

async function completeCurrentPhase(cwd: string, now: string) {
  const state = await readActiveRequirement(cwd)

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

  phaseState.status = 'completed'
  phaseState.completed_at = now

  const phases = phasesForWorkflow(state.workflow)
  const index = phases.indexOf(state.current_phase)
  const nextPhase = phases[index + 1]

  if (nextPhase) {
    state.current_phase = nextPhase
    state.phases[nextPhase] = { status: 'in_progress' }
  } else {
    state.status = 'completed'
  }

  state.updated_at = now
  await writeRequirement(cwd, state)
  return state
}

function buildProgram(options: Required<RunOptions>) {
  const program = new Command()

  program
    .name('vega')
    .exitOverride()
    .configureOutput({
      writeOut: options.stdout,
      writeErr: options.stderr,
    })

  program
    .command('init')
    .description('initialize .vega-harness directories')
    .action(async () => {
      await ensureHarness(options.cwd)
    })

  const requirement = program.command('requirement').description('manage requirement state')

  requirement
    .command('init')
    .argument('<name>')
    .option('--workflow <workflow>', 'workflow type: lite or full', 'lite')
    .action(async (name: string, commandOptions: { workflow: string }) => {
      assertRequirementName(name)

      if (commandOptions.workflow !== 'lite' && commandOptions.workflow !== 'full') {
        throw new CliError('Workflow must be either "lite" or "full".')
      }

      await ensureHarness(options.cwd)

      if (!(await exists(requirementPath(options.cwd, name)))) {
        await writeRequirement(
          options.cwd,
          createRequirementState(name, commandOptions.workflow, options.now().toISOString()),
        )
      }

      await writeFile(activePath(options.cwd), `${name}\n`)
    })

  requirement
    .command('status')
    .option('--json', 'print JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      emitState(await readActiveRequirement(options.cwd), commandOptions.json, options.stdout)
    })

  requirement
    .command('current')
    .option('--json', 'print JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      const current = await readActiveRequirementName(options.cwd)

      if (commandOptions.json) {
        emitJson({ current }, options.stdout)
        return
      }

      options.stdout(`${current}\n`)
    })

  requirement
    .command('list')
    .option('--json', 'print JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      await ensureHarness(options.cwd)
      const entries = await readdir(requirementsDir(options.cwd))
      const states = (
        await Promise.all(
          entries
            .filter((entry) => entry.endsWith('.json'))
            .map((entry) => readRequirement(options.cwd, entry.slice(0, -'.json'.length))),
        )
      )
        .map(summarizeRequirement)
        .sort((left, right) => left.name.localeCompare(right.name))

      if (commandOptions.json) {
        emitJson(states, options.stdout)
        return
      }

      for (const state of states) {
        options.stdout(`${state.name}: ${state.current_phase} (${state.status})\n`)
      }
    })

  requirement
    .command('switch')
    .argument('<name>')
    .action(async (name: string) => {
      assertRequirementName(name)
      await ensureHarness(options.cwd)
      await readRequirement(options.cwd, name)
      await writeFile(activePath(options.cwd), `${name}\n`)
    })

  program
    .command('next')
    .option('--json', 'print JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      const payload = getNextPayload(await readActiveRequirement(options.cwd))

      if (commandOptions.json) {
        emitJson(payload, options.stdout)
        return
      }

      options.stdout(payload.done ? 'done\n' : `${payload.skill}\n`)
    })

  program.command('complete').action(async () => {
    await completeCurrentPhase(options.cwd, options.now().toISOString())
  })

  program.command('archive').action(async () => {
    const state = await readActiveRequirement(options.cwd)

    if (state.status === 'completed') {
      return
    }

    if (state.current_phase !== 'archive') {
      throw new CliError('Archive can only complete a requirement that is already in the archive phase.')
    }

    await completeCurrentPhase(options.cwd, options.now().toISOString())
  })

  program
    .command('fail')
    .option('--reason <reason>', 'failure reason')
    .action(async (commandOptions: { reason?: string }) => {
      const state = await readActiveRequirement(options.cwd)

      if (state.status === 'completed') {
        throw new CliError('Completed requirements cannot be marked failed.')
      }

      const phaseState = currentPhaseState(state)
      phaseState.status = 'failed'
      phaseState.failed_at = options.now().toISOString()

      if (commandOptions.reason) {
        phaseState.failed_reason = commandOptions.reason
      }

      state.updated_at = options.now().toISOString()
      await writeRequirement(options.cwd, state)
    })

  program.command('retry').action(async () => {
    const state = await readActiveRequirement(options.cwd)
    const phaseState = currentPhaseState(state)

    if (phaseState.status !== 'failed') {
      throw new CliError(`Current phase "${state.current_phase}" is not failed.`)
    }

    phaseState.status = 'in_progress'
    delete phaseState.failed_at
    delete phaseState.failed_reason
    state.updated_at = options.now().toISOString()
    await writeRequirement(options.cwd, state)
  })

  return program
}

export async function runVega(args: string[], runOptions: RunOptions = {}) {
  const options: Required<RunOptions> = {
    cwd: runOptions.cwd ?? process.cwd(),
    now: runOptions.now ?? (() => new Date()),
    stdout: runOptions.stdout ?? ((value) => process.stdout.write(value)),
    stderr: runOptions.stderr ?? ((value) => process.stderr.write(value)),
  }

  try {
    await buildProgram(options).parseAsync(args, { from: 'user' })
    return 0
  } catch (error) {
    if (error instanceof CliError) {
      options.stderr(`Error: ${error.message}\n`)
      return error.exitCode
    }

    if (error instanceof CommanderError) {
      return error.exitCode
    }

    throw error
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  runVega(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode
  })
}
