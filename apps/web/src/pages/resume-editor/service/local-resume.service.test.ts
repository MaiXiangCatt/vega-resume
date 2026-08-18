import 'fake-indexeddb/auto';

import { Blob as NodeBlob } from 'node:buffer';

import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';

import { LOCAL_RESUME_LIMIT } from '../model/local-resume';
import { createDefaultContent } from '../model/resume.model';
import type { ResumeDocument, ResumeImportEnvelope } from '../model/resume.types';
import {
  createLocalResumeService,
  LOCAL_DATABASE_NAME,
  LocalResumeConflictError,
  LocalResumeDataError,
  LocalResumeLimitError,
  LocalResumeStorageError,
  listDocuments,
  openLocalDatabase,
} from './local-resume.service';

function createDocument(
  id = 'guest-primary',
  title = '旧的本地简历',
  revision = 1,
): ResumeDocument {
  return {
    id,
    title,
    status: 'draft',
    revision,
    hasAvatar: false,
    hasSchoolLogo: false,
    profileAlignment: 'left',
    exportCount: 0,
    contentVersion: 4,
    content: createDefaultContent(),
    createdAt: '2026-07-30T08:00:00.000Z',
    updatedAt: '2026-07-30T08:00:00.000Z',
  };
}

async function seedLegacyResume(avatar: Blob | null = null) {
  const content = structuredClone(createDefaultContent()) as {
    profile: Record<string, unknown>;
    formatting: Record<string, unknown>;
  };
  delete content.profile.enabled;
  delete content.formatting.entryGapPx;
  const database = await openLocalDatabase();
  await database.put('guest-resume', {
    key: 'primary',
    storageVersion: 1,
    document: {
      ...createDocument(),
      templateId: 'classic-professional',
      profileAlignment: undefined,
      contentVersion: 2,
      content,
    },
  });
  if (avatar) await database.put('guest-assets', avatar, 'avatar');
  database.close();
}

describe('local resume service', () => {
  beforeEach(async () => {
    await deleteDB(LOCAL_DATABASE_NAME);
  });

  it('keeps a new local library empty until the user creates a resume', async () => {
    const service = createLocalResumeService();

    expect(await service.list(defaultQuery())).toEqual({
      items: [],
      page: 1,
      pageSize: 6,
      total: 0,
    });
    expect(await service.stats()).toEqual({
      completed: 0,
      draft: 0,
      exported: 0,
      total: 0,
    });
  });

  it('reads and updates the legacy primary resume and avatar in place', async () => {
    await seedLegacyResume(new NodeBlob(['legacy-avatar'], { type: 'image/jpeg' }) as Blob);
    const service = createLocalResumeService();

    const loaded = await service.get('guest-primary');
    const saved = await service.save(
      { ...loaded.document, title: '继续编辑旧简历' },
      loaded.document.revision,
    );
    const database = await openLocalDatabase();
    const stored = await database.get('guest-resume', 'primary');
    const avatar = await database.get('guest-assets', 'avatar');
    database.close();

    expect(loaded.document.hasAvatar).toBe(true);
    expect(loaded.document).toMatchObject({
      contentVersion: 4,
      profileAlignment: 'center',
      content: { formatting: { entryGapPx: 14 } },
    });
    expect(await blobText(loaded.avatar)).toBe('legacy-avatar');
    expect(saved).toMatchObject({ id: 'guest-primary', revision: 2, title: '继续编辑旧简历' });
    expect(stored).toMatchObject({
      key: 'primary',
      storageVersion: 1,
      document: {
        contentVersion: 4,
        profileAlignment: 'center',
        content: { formatting: { entryGapPx: 14 } },
      },
    });
    expect(await blobText(avatar ?? null)).toBe('legacy-avatar');
  });

  it('creates, copies and deletes independent resumes with their image assets', async () => {
    let id = 0;
    const service = createLocalResumeService({
      createId: () => `local-${++id}`,
      now: () => new Date('2026-07-30T09:00:00.000Z'),
    });

    const created = await service.create('产品简历');
    const withAvatar = await service.putAvatar(
      created,
      new NodeBlob(['avatar'], { type: 'image/jpeg' }) as Blob,
    );
    const withSchoolLogo = await service.putSchoolLogo(
      withAvatar,
      new NodeBlob(['school-logo'], { type: 'image/png' }) as Blob,
    );
    const copied = await service.copy(withSchoolLogo.id);

    expect(copied).toMatchObject({
      id: 'local-2',
      title: '产品简历 - 副本',
      status: 'draft',
      revision: 1,
      exportCount: 0,
      hasAvatar: true,
      hasSchoolLogo: true,
    });
    const copiedAssets = await service.get(copied.id);
    expect(await blobText(copiedAssets.avatar)).toBe('avatar');
    expect(await blobText(copiedAssets.schoolLogo)).toBe('school-logo');

    await service.delete(withSchoolLogo.id);
    await expect(service.get(withSchoolLogo.id)).rejects.toThrow('不存在');
    expect((await service.get(copied.id)).document.title).toBe('产品简历 - 副本');
  });

  it('imports v4 JSON as a new draft and includes it in filtering and stats', async () => {
    const service = createLocalResumeService({ createId: () => 'imported-id' });
    const envelope: ResumeImportEnvelope = {
      version: 4,
      title: '  前端工程师简历  ',
      profileAlignment: 'center',
      content: createDefaultContent(),
      avatar: `data:image/jpeg;base64,${btoa('avatar')}`,
      schoolLogo: `data:image/png;base64,${btoa('school-logo')}`,
    };

    const imported = await service.import(envelope);
    const renamed = await service.updateTitle(imported.id, imported.revision, '前端平台工程师');
    const completed = await service.save({ ...renamed, status: 'completed' }, renamed.revision);
    await service.recordExport(completed.id);
    const list = await service.list({ ...defaultQuery(), query: '工程师' });

    expect(imported).toMatchObject({
      id: 'imported-id',
      title: '前端工程师简历',
      status: 'draft',
      hasAvatar: true,
      hasSchoolLogo: true,
    });
    const importedAssets = await service.get(imported.id);
    expect(importedAssets.schoolLogo).not.toBeNull();
    expect(list.items).toHaveLength(1);
    expect(await service.stats()).toEqual({
      completed: 1,
      draft: 0,
      exported: 1,
      total: 1,
    });
  });

  it('enforces the 20 resume limit for create, copy and import, then allows creation after delete', async () => {
    let id = 0;
    const service = createLocalResumeService({ createId: () => `resume-${++id}` });

    const results = await Promise.allSettled(
      Array.from({ length: LOCAL_RESUME_LIMIT + 1 }, () => service.create()),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
      LOCAL_RESUME_LIMIT,
    );
    expect(
      results.some(
        (result) => result.status === 'rejected' && result.reason instanceof LocalResumeLimitError,
      ),
    ).toBe(true);
    const first = (await service.list({ ...defaultQuery(), pageSize: 24 })).items[0];
    await expect(service.copy(first.id)).rejects.toBeInstanceOf(LocalResumeLimitError);
    await expect(
      service.import({
        version: 4,
        title: '额外导入',
        profileAlignment: 'left',
        content: createDefaultContent(),
        avatar: null,
      }),
    ).rejects.toBeInstanceOf(LocalResumeLimitError);
    await service.delete(first.id);
    await expect(service.create()).resolves.toMatchObject({ id: 'resume-23' });
  });

  it('searches case-insensitively and combines status, sorting and pagination', () => {
    const documents = [
      {
        ...createDocument('one', '  Alpha Resume  '),
        status: 'completed' as const,
        createdAt: '2026-07-28T08:00:00.000Z',
        updatedAt: '2026-07-30T08:00:00.000Z',
      },
      {
        ...createDocument('two', 'beta resume'),
        createdAt: '2026-07-30T08:00:00.000Z',
        updatedAt: '2026-07-29T08:00:00.000Z',
      },
      {
        ...createDocument('three', 'ALPHA Portfolio'),
        status: 'completed' as const,
        createdAt: '2026-07-29T08:00:00.000Z',
        updatedAt: '2026-07-28T08:00:00.000Z',
      },
    ];

    const filtered = listDocuments(documents, {
      ...defaultQuery(),
      query: '  alpha ',
      status: 'completed',
      sort: 'title_asc',
    });
    const paged = listDocuments(documents, {
      ...defaultQuery(),
      page: 2,
      pageSize: 6,
      sort: 'created_desc',
    });

    expect(filtered.items.map((item) => item.id)).toEqual(['three', 'one']);
    expect(paged).toMatchObject({ items: [], page: 2, total: 3 });
  });

  it('rejects stale revisions and malformed legacy data without overwriting it', async () => {
    await seedLegacyResume();
    const service = createLocalResumeService();
    const loaded = await service.get('guest-primary');
    await service.save({ ...loaded.document, title: '第一个标签页' }, loaded.document.revision);

    await expect(
      service.save({ ...loaded.document, title: '第二个标签页' }, loaded.document.revision),
    ).rejects.toBeInstanceOf(LocalResumeConflictError);

    const database = await openLocalDatabase();
    await database.put('guest-resume', {
      key: 'broken',
      storageVersion: 2,
      document: createDocument('different-id'),
    });
    database.close();
    await expect(service.loadLibrary()).rejects.toBeInstanceOf(LocalResumeDataError);
  });

  it('surfaces database failures instead of creating an editable temporary resume', async () => {
    const service = createLocalResumeService({
      openDatabase: async () => {
        throw new DOMException('blocked', 'InvalidStateError');
      },
    });

    await expect(service.loadLibrary()).rejects.toBeInstanceOf(LocalResumeStorageError);
    await expect(service.retry()).rejects.toBeInstanceOf(LocalResumeStorageError);
    await expect(service.create()).rejects.toBeInstanceOf(LocalResumeStorageError);
  });
});

function defaultQuery() {
  return {
    page: 1,
    pageSize: 6 as const,
    query: '',
    sort: 'updated_desc' as const,
  };
}

async function blobText(blob: Blob | null): Promise<string | null> {
  if (!blob) return null;
  return (blob as Blob & { text(): Promise<string> }).text();
}
