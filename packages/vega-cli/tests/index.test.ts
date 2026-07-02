import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runVega } from '../src'
import type { CommandRunner } from '../src/core/types'

const fixedNow = () => new Date('2026-06-01T00:00:00.000Z')

const workspaces: string[] = []

async function createWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'vega-cli-test-'))
  workspaces.push(cwd)
  return cwd
}

async function run(args: string[], cwd: string, commandRunner: CommandRunner = async () => {}) {
  let stdout = ''
  let stderr = ''
  const exitCode = await runVega(args, {
    cwd,
    now: fixedNow,
    stdout: (value) => {
      stdout += value
    },
    stderr: (value) => {
      stderr += value
    },
    commandRunner,
  })

  return { exitCode, stdout, stderr }
}

describe('vega CLI core commands', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((path) => rm(path, { force: true, recursive: true })))
  })

  it('initializes the harness directory structure', async () => {
    const cwd = await createWorkspace()
    const commands: Array<{ command: string; args: string[]; cwd: string }> = []

    const result = await run(['init'], cwd, async (command, args, options) => {
      commands.push({ command, args: [...args], cwd: options.cwd })
    })

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: 'Initialized .vega-harness\nInstalling Vega skills...\nInstalled Vega skills.\n',
      stderr: '',
    })
    expect(commands).toEqual([
      {
        command: 'npx',
        args: ['skills', 'add', 'MaiXiangCatt/vega-resume', '--skill', '*'],
        cwd,
      },
    ])
    expect(await readFile(join(cwd, '.vega-harness', '.active'), 'utf8')).toBe('')
    expect((await stat(join(cwd, '.vega-harness', 'requirements'))).isDirectory()).toBe(true)
    expect((await stat(join(cwd, '.vega-harness', 'docs'))).isDirectory()).toBe(true)
  })

  it('creates a lite requirement from the init phase and exposes status as JSON', async () => {
    const cwd = await createWorkspace()

    expect(await run(['requirement', 'init', 'resume-editor'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Requirement "resume-editor" is active (workflow: lite, phase: init).\n',
      stderr: '',
    })
    const result = await run(['requirement', 'status', '--json'], cwd)

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      name: 'resume-editor',
      workflow: 'lite',
      status: 'in_progress',
      current_phase: 'init',
      phases: {
        init: { status: 'in_progress' },
        brainstorm: { status: 'pending' },
        openspec: { status: 'pending' },
        implementation: { status: 'pending' },
        verification: { status: 'pending' },
        archive: { status: 'pending' },
      },
      documents: {
        prd: null,
        brainstorm: null,
        openspec_dir: null,
      },
      modules: [],
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    })
    expect(await readFile(join(cwd, '.vega-harness', '.active'), 'utf8')).toBe('resume-editor\n')
  })

  it('reports the executable skill for the current in-progress phase', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)
    const result = await run(['next', '--json'], cwd)

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      requirement: 'resume-editor',
      workflow: 'lite',
      phase: 'init',
      status: 'in_progress',
      skill: 'vega-requirement-init',
      done: false,
    })
  })

  it('completes lite phases in order and marks the requirement done after archive', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)
    expect(await run(['complete'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Completed phase "init"; next phase is "brainstorm".\n',
      stderr: '',
    })

    expect(JSON.parse((await run(['next', '--json'], cwd)).stdout)).toMatchObject({
      phase: 'brainstorm',
      skill: 'vega-brainstorm',
      done: false,
    })

    for (const _phase of ['brainstorm', 'openspec', 'implementation', 'verification']) {
      await run(['complete'], cwd)
    }

    expect(JSON.parse((await run(['next', '--json'], cwd)).stdout)).toMatchObject({
      phase: 'archive',
      skill: 'vega-archive',
      done: false,
    })

    expect(await run(['archive'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Archived requirement "resume-editor".\n',
      stderr: '',
    })

    expect(JSON.parse((await run(['next', '--json'], cwd)).stdout)).toEqual({
      requirement: 'resume-editor',
      workflow: 'lite',
      phase: 'archive',
      status: 'completed',
      skill: null,
      done: true,
    })
  })

  it('uses the full workflow phase order when requested', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor', '--workflow', 'full'], cwd)

    const expectedPhases = [
      ['init', 'vega-requirement-init'],
      ['brainstorm', 'vega-brainstorm'],
      ['tech_design', 'vega-tech-design'],
      ['breakdown', 'vega-breakdown'],
      ['openspec', 'vega-openspec'],
      ['implementation', 'vega-implementation'],
      ['verification', 'vega-verification'],
      ['archive', 'vega-archive'],
    ]

    for (const [phase, skill] of expectedPhases) {
      expect(JSON.parse((await run(['next', '--json'], cwd)).stdout)).toMatchObject({
        phase,
        skill,
        done: false,
      })
      await run(['complete'], cwd)
    }
  })

  it('transitions to the next phase and rejects out-of-order transitions without force', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)

    expect(await run(['transition', 'implementation'], cwd)).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Phase "implementation" is not the next phase after "init".\n',
    })
    expect(await run(['transition', 'brainstorm'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Transitioned to phase "brainstorm".\n',
      stderr: '',
    })

    const state = JSON.parse(await readFile(join(cwd, '.vega-harness', 'requirements', 'resume-editor.json'), 'utf8'))
    expect(state.current_phase).toBe('brainstorm')
    expect(state.phases.init).toMatchObject({
      status: 'completed',
      completed_at: '2026-06-01T00:00:00.000Z',
    })
    expect(state.phases.brainstorm).toEqual({ status: 'in_progress' })
  })

  it('force transitions to any phase in the active workflow', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)
    await run(['fail', '--reason', 'manual recovery'], cwd)

    expect(await run(['transition', 'implementation', '--force'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Transitioned to phase "implementation".\n',
      stderr: '',
    })

    expect(JSON.parse((await run(['next', '--json'], cwd)).stdout)).toMatchObject({
      phase: 'implementation',
      status: 'in_progress',
      skill: 'vega-implementation',
    })
    expect(JSON.parse((await run(['verify', '--json'], cwd)).stdout)).toEqual({
      valid: true,
      errors: [],
    })
  })

  it('can list, switch, and report the active requirement', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'first'], cwd)
    await run(['requirement', 'init', 'second', '--workflow', 'full'], cwd)
    expect(await run(['requirement', 'switch', 'first'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Active requirement switched to "first".\n',
      stderr: '',
    })

    expect((await run(['requirement', 'current', '--json'], cwd)).stdout).toBe(
      JSON.stringify({ current: 'first' }) + '\n',
    )
    expect(JSON.parse((await run(['requirement', 'list', '--json'], cwd)).stdout)).toEqual([
      { name: 'first', workflow: 'lite', status: 'in_progress', current_phase: 'init' },
      { name: 'second', workflow: 'full', status: 'in_progress', current_phase: 'init' },
    ])
  })

  it('can set and get document paths on the active requirement', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)

    expect(await run(['doc', 'get', 'prd', '--json'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: JSON.stringify({ type: 'prd', path: null }) + '\n',
      stderr: '',
    })
    expect(await run(['doc', 'get', 'prd'], cwd)).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Error: No document path set for type "prd".\n',
    })

    expect(await run(['doc', 'set', 'prd', 'docs/designAndPrd/resume_mvp_prd_v2.md'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Document "prd" set to "docs/designAndPrd/resume_mvp_prd_v2.md".\n',
      stderr: '',
    })
    expect(await run(['doc', 'get', 'prd'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'docs/designAndPrd/resume_mvp_prd_v2.md\n',
      stderr: '',
    })

    const state = JSON.parse(await readFile(join(cwd, '.vega-harness', 'requirements', 'resume-editor.json'), 'utf8'))
    expect(state.documents.prd).toBe('docs/designAndPrd/resume_mvp_prd_v2.md')
  })

  it('can manage modules for a full workflow requirement', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor', '--workflow', 'full'], cwd)

    expect(await run(['module', 'list'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
    expect(await run(['module', 'add', 'web-editor'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Module "web-editor" added.\n',
      stderr: '',
    })
    expect(await run(['module', 'add', 'api-server'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Module "api-server" added.\n',
      stderr: '',
    })
    expect(await run(['module', 'add', 'web-editor'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Module "web-editor" added.\n',
      stderr: '',
    })

    expect(await run(['module', 'list'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'api-server: pending\nweb-editor: pending\n',
      stderr: '',
    })

    const pendingModule = JSON.parse((await run(['module', 'status', 'web-editor', '--json'], cwd)).stdout)
    expect(pendingModule).toEqual({
      name: 'web-editor',
      status: 'pending',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    })

    expect(await run(['module', 'complete', 'web-editor'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Module "web-editor" completed.\n',
      stderr: '',
    })
    expect(await run(['module', 'complete', 'web-editor'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Module "web-editor" completed.\n',
      stderr: '',
    })

    expect(await run(['module', 'status', 'web-editor'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'web-editor: completed\n',
      stderr: '',
    })
    expect(JSON.parse((await run(['module', 'list', '--json'], cwd)).stdout)).toEqual([
      {
        name: 'api-server',
        status: 'pending',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
      {
        name: 'web-editor',
        status: 'completed',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
        completed_at: '2026-06-01T00:00:00.000Z',
      },
    ])
  })

  it('rejects module commands for lite workflow requirements', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)

    expect(await run(['module', 'add', 'web-editor'], cwd)).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Module commands are only available for full workflow requirements.\n',
    })
  })

  it('verifies valid and invalid active requirement state', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)

    expect(await run(['verify'], cwd)).toEqual({
      exitCode: 0,
      stdout: 'State is valid.\n',
      stderr: '',
    })
    expect(JSON.parse((await run(['verify', '--json'], cwd)).stdout)).toEqual({
      valid: true,
      errors: [],
    })

    const statePath = join(cwd, '.vega-harness', 'requirements', 'resume-editor.json')
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    delete state.phases.init
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)

    const result = await run(['verify', '--json'], cwd)

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({
      valid: false,
      errors: [
        'Missing phase "init".',
        'In-progress requirements must have exactly one in-progress phase matching current_phase.',
      ],
    })
    expect(result.stderr).toBe('Error: State verification failed.\n')
  })

  it('routes failed phases to experience and lets retry resume the current phase', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)
    expect(await run(['fail', '--reason', 'lint failed'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Marked phase "init" as failed.\n',
      stderr: '',
    })

    expect(JSON.parse((await run(['next', '--json'], cwd)).stdout)).toMatchObject({
      phase: 'init',
      status: 'failed',
      skill: 'vega-experience',
      done: false,
    })
    expect(JSON.parse((await run(['verify', '--json'], cwd)).stdout)).toEqual({
      valid: true,
      errors: [],
    })

    expect(await run(['retry'], cwd)).toMatchObject({
      exitCode: 0,
      stdout: 'Retried phase "init"; status is in_progress.\n',
      stderr: '',
    })

    expect(JSON.parse((await run(['next', '--json'], cwd)).stdout)).toMatchObject({
      phase: 'init',
      status: 'in_progress',
      skill: 'vega-requirement-init',
      done: false,
    })
  })

  it('prints errors to stderr for invalid state transitions', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)
    const result = await run(['archive'], cwd)

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Archive can only complete a requirement that is already in the archive phase.\n',
    })
  })
})
