import { CliError } from '../errors'
import { readActiveRequirement, writeRequirement } from '../requirements'

export interface DocumentPointer {
  type: string
  path: string | null
}

export interface SetDocumentResult {
  type: string
  path: string
}

export function assertDocumentType(type: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(type)) {
    throw new CliError('Document types may only contain letters, numbers, dots, dashes, and underscores.')
  }
}

export async function getDocumentPath(cwd: string, type: string): Promise<DocumentPointer> {
  assertDocumentType(type)

  const state = await readActiveRequirement(cwd)

  return {
    type,
    path: state.documents[type] ?? null,
  }
}

export async function setDocumentPath(
  cwd: string,
  type: string,
  artifactPath: string,
  now: string,
): Promise<SetDocumentResult> {
  assertDocumentType(type)

  if (!artifactPath.trim()) {
    throw new CliError('Document path must not be empty.')
  }

  const state = await readActiveRequirement(cwd)

  if (state.documents[type] === artifactPath) {
    return {
      type,
      path: artifactPath,
    }
  }

  const nextState = {
    ...state,
    documents: {
      ...state.documents,
      [type]: artifactPath,
    },
    updated_at: now,
  }

  await writeRequirement(cwd, nextState)

  return {
    type,
    path: artifactPath,
  }
}
