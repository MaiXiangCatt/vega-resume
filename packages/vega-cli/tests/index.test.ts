import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runVega } from '../src'

const fixedNow = () => new Date('2026-06-01T00:00:00.000Z')

const workspaces: string[] = []

async function createWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'vega-cli-test-'))
  workspaces.push(cwd)
  return cwd
}

async function run(args: string[], cwd: string) {
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
  })

  return { exitCode, stdout, stderr }
}

describe('vega CLI core commands', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((path) => rm(path, { force: true, recursive: true })))
  })

  it('initializes the harness directory structure', async () => {
    const cwd = await createWorkspace()

    const result = await run(['init'], cwd)

    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(await readFile(join(cwd, '.vega-harness', '.active'), 'utf8')).toBe('')
    expect((await stat(join(cwd, '.vega-harness', 'requirements'))).isDirectory()).toBe(true)
    expect((await stat(join(cwd, '.vega-harness', 'docs'))).isDirectory()).toBe(true)
  })

  it('creates a lite requirement from the init phase and exposes status as JSON', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)
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
    await run(['complete'], cwd)

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

    await run(['archive'], cwd)

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

  it('can list, switch, and report the active requirement', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'first'], cwd)
    await run(['requirement', 'init', 'second', '--workflow', 'full'], cwd)
    await run(['requirement', 'switch', 'first'], cwd)

    expect((await run(['requirement', 'current', '--json'], cwd)).stdout).toBe(
      JSON.stringify({ current: 'first' }) + '\n',
    )
    expect(JSON.parse((await run(['requirement', 'list', '--json'], cwd)).stdout)).toEqual([
      { name: 'first', workflow: 'lite', status: 'in_progress', current_phase: 'init' },
      { name: 'second', workflow: 'full', status: 'in_progress', current_phase: 'init' },
    ])
  })

  it('routes failed phases to experience and lets retry resume the current phase', async () => {
    const cwd = await createWorkspace()

    await run(['requirement', 'init', 'resume-editor'], cwd)
    await run(['fail', '--reason', 'lint failed'], cwd)

    expect(JSON.parse((await run(['next', '--json'], cwd)).stdout)).toMatchObject({
      phase: 'init',
      status: 'failed',
      skill: 'vega-experience',
      done: false,
    })

    await run(['retry'], cwd)

    expect(JSON.parse((await run(['next', '--json'], cwd)).stdout)).toMatchObject({
      phase: 'init',
      status: 'in_progress',
      skill: 'vega-requirement-init',
      done: false,
    })
  })
})
