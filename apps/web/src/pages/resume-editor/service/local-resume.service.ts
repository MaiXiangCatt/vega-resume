import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type {
  LocalResumeLibrarySnapshot,
  LocalResumeListPayload,
  LocalResumeListQuery,
  LocalResumeRepository,
  LocalResumeStats,
} from '../model/local-resume';
import { LOCAL_RESUME_LIMIT } from '../model/local-resume';
import {
  createDefaultContent,
  normalizeProfileAlignment,
  parseImportEnvelope,
  parseResumeContent,
} from '../model/resume.model';
import type { ResumeDocument, ResumeImportEnvelope } from '../model/resume.types';

export const LOCAL_DATABASE_NAME = 'littleag-resume';

const DATABASE_VERSION = 1;
const RESUME_STORE = 'guest-resume';
const ASSET_STORE = 'guest-assets';
const LEGACY_RESUME_KEY = 'primary';
const LEGACY_RESUME_ID = 'guest-primary';
const LEGACY_AVATAR_KEY = 'avatar';
const LEGACY_SCHOOL_LOGO_KEY = 'school-logo';
const TITLE_LIMIT = 80;

type StoredResumeRecord = {
  document: unknown;
  key: string;
  storageVersion: 1 | 2;
};

interface LocalResumeDatabase extends DBSchema {
  [RESUME_STORE]: {
    key: string;
    value: StoredResumeRecord;
  };
  [ASSET_STORE]: {
    key: string;
    value: Blob;
  };
}

export type LocalDatabase = IDBPDatabase<LocalResumeDatabase>;

type LocalResumeServiceOptions = {
  createId?: () => string;
  now?: () => Date;
  openDatabase?: () => Promise<LocalDatabase>;
};

export class LocalResumeConflictError extends Error {
  constructor() {
    super('这份本地简历已在另一个页面更新');
    this.name = 'LocalResumeConflictError';
  }
}

export class LocalResumeNotFoundError extends Error {
  constructor() {
    super('这份本地简历不存在或已被删除');
    this.name = 'LocalResumeNotFoundError';
  }
}

export class LocalResumeLimitError extends Error {
  constructor() {
    super(`本地最多保存 ${LOCAL_RESUME_LIMIT} 份简历`);
    this.name = 'LocalResumeLimitError';
  }
}

export class LocalResumeDataError extends Error {
  constructor() {
    super('浏览器中的本地简历数据无法读取');
    this.name = 'LocalResumeDataError';
  }
}

export class LocalResumeStorageError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('浏览器本地存储暂时不可用');
    this.name = 'LocalResumeStorageError';
    this.cause = cause;
  }
}

export function createLocalResumeService(
  options: LocalResumeServiceOptions = {},
): LocalResumeRepository {
  const createId = options.createId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  const openDatabase = options.openDatabase ?? openLocalDatabase;

  async function withDatabase<T>(operation: (database: LocalDatabase) => Promise<T>): Promise<T> {
    let database: LocalDatabase;
    try {
      database = await openDatabase();
    } catch (error) {
      throw new LocalResumeStorageError(error);
    }
    try {
      return await operation(database);
    } catch (error) {
      if (isLocalResumeDomainError(error)) throw error;
      throw new LocalResumeStorageError(error);
    } finally {
      database.close();
    }
  }

  async function loadLibrary(): Promise<LocalResumeLibrarySnapshot> {
    return withDatabase(async (database) => {
      const transaction = database.transaction([RESUME_STORE, ASSET_STORE], 'readonly');
      const records = await transaction.objectStore(RESUME_STORE).getAll();
      const documents = new Map<string, ResumeDocument>();
      const avatars = new Map<string, Blob>();
      const schoolLogos = new Map<string, Blob>();

      for (const record of records) {
        const document = parseStoredRecord(record);
        if (documents.has(document.id)) throw new LocalResumeDataError();
        documents.set(document.id, document);
      }
      for (const document of documents.values()) {
        const avatar =
          (await transaction.objectStore(ASSET_STORE).get(assetKey(document.id))) ?? null;
        const schoolLogo =
          (await transaction.objectStore(ASSET_STORE).get(schoolLogoAssetKey(document.id))) ?? null;
        if (avatar) avatars.set(document.id, avatar);
        if (schoolLogo) schoolLogos.set(document.id, schoolLogo);
        document.hasAvatar = Boolean(avatar);
        document.hasSchoolLogo = Boolean(schoolLogo);
      }
      await transaction.done;
      return { avatars, schoolLogos, documents };
    });
  }

  async function get(resumeId: string): Promise<{
    avatar: Blob | null;
    schoolLogo: Blob | null;
    document: ResumeDocument;
  }> {
    return withDatabase(async (database) => {
      const transaction = database.transaction([RESUME_STORE, ASSET_STORE], 'readonly');
      const stored = await transaction.objectStore(RESUME_STORE).get(resumeKey(resumeId));
      if (!stored) throw new LocalResumeNotFoundError();
      const document = parseStoredRecord(stored, resumeId);
      const avatar = (await transaction.objectStore(ASSET_STORE).get(assetKey(resumeId))) ?? null;
      const schoolLogo =
        (await transaction.objectStore(ASSET_STORE).get(schoolLogoAssetKey(resumeId))) ?? null;
      await transaction.done;
      return {
        avatar,
        schoolLogo,
        document: {
          ...document,
          hasAvatar: Boolean(avatar),
          hasSchoolLogo: Boolean(schoolLogo),
        },
      };
    });
  }

  async function has(resumeId: string): Promise<boolean> {
    return withDatabase(async (database) =>
      Boolean(await database.get(RESUME_STORE, resumeKey(resumeId))),
    );
  }

  async function create(title = '未命名简历'): Promise<ResumeDocument> {
    const resumeId = createId();
    const document = createDocument(resumeId, validateTitle(title), now());
    return withDatabase(async (database) => {
      const transaction = database.transaction(RESUME_STORE, 'readwrite');
      await assertBelowLimit(transaction.objectStore(RESUME_STORE));
      await transaction.objectStore(RESUME_STORE).add(toRecord(document));
      await transaction.done;
      return cloneDocument(document);
    });
  }

  async function importResume(envelope: ResumeImportEnvelope): Promise<ResumeDocument> {
    const parsed = parseImportEnvelope(envelope);
    const avatar = parsed.avatar ? dataUrlToBlob(parsed.avatar) : null;
    const schoolLogo = parsed.schoolLogo ? dataUrlToBlob(parsed.schoolLogo) : null;
    const document = createDocument(createId(), validateTitle(parsed.title), now(), {
      content: parsed.content,
      hasAvatar: Boolean(avatar),
      hasSchoolLogo: Boolean(schoolLogo),
      profileAlignment: parsed.profileAlignment,
    });
    return withDatabase(async (database) => {
      const transaction = database.transaction([RESUME_STORE, ASSET_STORE], 'readwrite');
      await assertBelowLimit(transaction.objectStore(RESUME_STORE));
      await transaction.objectStore(RESUME_STORE).add(toRecord(document));
      if (avatar) await transaction.objectStore(ASSET_STORE).put(avatar, assetKey(document.id));
      if (schoolLogo)
        await transaction.objectStore(ASSET_STORE).put(schoolLogo, schoolLogoAssetKey(document.id));
      await transaction.done;
      return cloneDocument(document);
    });
  }

  async function copy(resumeId: string): Promise<ResumeDocument> {
    return withDatabase(async (database) => {
      const transaction = database.transaction([RESUME_STORE, ASSET_STORE], 'readwrite');
      const resumeStore = transaction.objectStore(RESUME_STORE);
      await assertBelowLimit(resumeStore);
      const sourceRecord = await resumeStore.get(resumeKey(resumeId));
      if (!sourceRecord) throw new LocalResumeNotFoundError();
      const source = parseStoredRecord(sourceRecord, resumeId);
      const copiedAt = now().toISOString();
      const document: ResumeDocument = {
        ...cloneDocument(source),
        id: createId(),
        title: copyTitle(source.title),
        status: 'draft',
        revision: 1,
        exportCount: 0,
        createdAt: copiedAt,
        updatedAt: copiedAt,
      };
      const avatar = (await transaction.objectStore(ASSET_STORE).get(assetKey(resumeId))) ?? null;
      const schoolLogo =
        (await transaction.objectStore(ASSET_STORE).get(schoolLogoAssetKey(resumeId))) ?? null;
      document.hasAvatar = Boolean(avatar);
      document.hasSchoolLogo = Boolean(schoolLogo);
      await resumeStore.add(toRecord(document));
      if (avatar) {
        await transaction.objectStore(ASSET_STORE).put(avatar, assetKey(document.id));
      }
      if (schoolLogo) {
        await transaction.objectStore(ASSET_STORE).put(schoolLogo, schoolLogoAssetKey(document.id));
      }
      await transaction.done;
      return cloneDocument(document);
    });
  }

  async function save(document: ResumeDocument, expectedRevision: number): Promise<ResumeDocument> {
    return updateDocument(document.id, expectedRevision, () => validateDocument(document));
  }

  async function overwrite(document: ResumeDocument): Promise<ResumeDocument> {
    return withDatabase(async (database) => {
      const transaction = database.transaction(RESUME_STORE, 'readwrite');
      const store = transaction.objectStore(RESUME_STORE);
      const stored = await store.get(resumeKey(document.id));
      if (!stored) throw new LocalResumeNotFoundError();
      const current = parseStoredRecord(stored, document.id);
      const saved = nextRevision(validateDocument(document), current.revision, now());
      await store.put(toRecord(saved));
      await transaction.done;
      return cloneDocument(saved);
    });
  }

  async function updateTitle(
    resumeId: string,
    expectedRevision: number,
    title: string,
  ): Promise<ResumeDocument> {
    return updateDocument(resumeId, expectedRevision, (current) => ({
      ...current,
      title: validateTitle(title),
    }));
  }

  async function replaceImport(
    resumeId: string,
    expectedRevision: number,
    envelope: ResumeImportEnvelope,
  ): Promise<ResumeDocument> {
    const parsed = parseImportEnvelope(envelope);
    const avatar = parsed.avatar ? dataUrlToBlob(parsed.avatar) : null;
    const schoolLogo = parsed.schoolLogo ? dataUrlToBlob(parsed.schoolLogo) : null;
    return withDatabase(async (database) => {
      const transaction = database.transaction([RESUME_STORE, ASSET_STORE], 'readwrite');
      const store = transaction.objectStore(RESUME_STORE);
      const stored = await store.get(resumeKey(resumeId));
      if (!stored) throw new LocalResumeNotFoundError();
      const current = parseStoredRecord(stored, resumeId);
      assertRevision(current, expectedRevision);
      const saved = nextRevision(
        {
          ...current,
          title: validateTitle(parsed.title),
          profileAlignment: parsed.profileAlignment,
          content: parsed.content,
          contentVersion: 4,
          hasAvatar: Boolean(avatar),
          hasSchoolLogo: Boolean(schoolLogo),
        },
        expectedRevision,
        now(),
      );
      await store.put(toRecord(saved));
      if (avatar) await transaction.objectStore(ASSET_STORE).put(avatar, assetKey(resumeId));
      else await transaction.objectStore(ASSET_STORE).delete(assetKey(resumeId));
      if (schoolLogo)
        await transaction.objectStore(ASSET_STORE).put(schoolLogo, schoolLogoAssetKey(resumeId));
      else await transaction.objectStore(ASSET_STORE).delete(schoolLogoAssetKey(resumeId));
      await transaction.done;
      return cloneDocument(saved);
    });
  }

  async function putAvatar(document: ResumeDocument, avatar: Blob): Promise<ResumeDocument> {
    return updateAvatar(document, avatar);
  }

  async function deleteAvatar(document: ResumeDocument): Promise<ResumeDocument> {
    return updateAvatar(document, null);
  }

  async function putSchoolLogo(
    document: ResumeDocument,
    schoolLogo: Blob,
  ): Promise<ResumeDocument> {
    return updateSchoolLogo(document, schoolLogo);
  }

  async function deleteSchoolLogo(document: ResumeDocument): Promise<ResumeDocument> {
    return updateSchoolLogo(document, null);
  }

  async function updateAvatar(
    document: ResumeDocument,
    avatar: Blob | null,
  ): Promise<ResumeDocument> {
    return withDatabase(async (database) => {
      const transaction = database.transaction([RESUME_STORE, ASSET_STORE], 'readwrite');
      const store = transaction.objectStore(RESUME_STORE);
      const stored = await store.get(resumeKey(document.id));
      if (!stored) throw new LocalResumeNotFoundError();
      const current = parseStoredRecord(stored, document.id);
      assertRevision(current, document.revision);
      const saved = nextRevision(
        { ...validateDocument(document), hasAvatar: Boolean(avatar) },
        document.revision,
        now(),
      );
      await store.put(toRecord(saved));
      if (avatar) await transaction.objectStore(ASSET_STORE).put(avatar, assetKey(document.id));
      else await transaction.objectStore(ASSET_STORE).delete(assetKey(document.id));
      await transaction.done;
      return cloneDocument(saved);
    });
  }

  async function updateSchoolLogo(
    document: ResumeDocument,
    schoolLogo: Blob | null,
  ): Promise<ResumeDocument> {
    return withDatabase(async (database) => {
      const transaction = database.transaction([RESUME_STORE, ASSET_STORE], 'readwrite');
      const store = transaction.objectStore(RESUME_STORE);
      const stored = await store.get(resumeKey(document.id));
      if (!stored) throw new LocalResumeNotFoundError();
      const current = parseStoredRecord(stored, document.id);
      assertRevision(current, document.revision);
      const saved = nextRevision(
        { ...validateDocument(document), hasSchoolLogo: Boolean(schoolLogo) },
        document.revision,
        now(),
      );
      await store.put(toRecord(saved));
      if (schoolLogo)
        await transaction.objectStore(ASSET_STORE).put(schoolLogo, schoolLogoAssetKey(document.id));
      else await transaction.objectStore(ASSET_STORE).delete(schoolLogoAssetKey(document.id));
      await transaction.done;
      return cloneDocument(saved);
    });
  }

  async function deleteResume(resumeId: string): Promise<void> {
    await withDatabase(async (database) => {
      const transaction = database.transaction([RESUME_STORE, ASSET_STORE], 'readwrite');
      const store = transaction.objectStore(RESUME_STORE);
      if (!(await store.get(resumeKey(resumeId)))) throw new LocalResumeNotFoundError();
      await store.delete(resumeKey(resumeId));
      await transaction.objectStore(ASSET_STORE).delete(assetKey(resumeId));
      await transaction.objectStore(ASSET_STORE).delete(schoolLogoAssetKey(resumeId));
      await transaction.done;
    });
  }

  async function recordExport(resumeId: string): Promise<ResumeDocument> {
    return updateDocument(resumeId, undefined, (current) => ({
      ...current,
      exportCount: current.exportCount + 1,
    }));
  }

  async function updateDocument(
    resumeId: string,
    expectedRevision: number | undefined,
    update: (current: ResumeDocument) => ResumeDocument,
  ): Promise<ResumeDocument> {
    return withDatabase(async (database) => {
      const transaction = database.transaction(RESUME_STORE, 'readwrite');
      const store = transaction.objectStore(RESUME_STORE);
      const stored = await store.get(resumeKey(resumeId));
      if (!stored) throw new LocalResumeNotFoundError();
      const current = parseStoredRecord(stored, resumeId);
      if (expectedRevision !== undefined) assertRevision(current, expectedRevision);
      const saved = nextRevision(validateDocument(update(current)), current.revision, now());
      await store.put(toRecord(saved));
      await transaction.done;
      return cloneDocument(saved);
    });
  }

  async function list(query: LocalResumeListQuery): Promise<LocalResumeListPayload> {
    const { documents } = await loadLibrary();
    return listDocuments([...documents.values()], query);
  }

  async function stats(): Promise<LocalResumeStats> {
    const { documents } = await loadLibrary();
    return summarizeDocuments(documents.values());
  }

  async function clear(): Promise<void> {
    try {
      await deleteDB(LOCAL_DATABASE_NAME);
    } catch (error) {
      throw new LocalResumeStorageError(error);
    }
  }

  async function retry(): Promise<LocalResumeLibrarySnapshot> {
    return loadLibrary();
  }

  return {
    clear,
    copy,
    create,
    delete: deleteResume,
    deleteAvatar,
    deleteSchoolLogo,
    get,
    has,
    import: importResume,
    list,
    loadLibrary,
    overwrite,
    putAvatar,
    putSchoolLogo,
    recordExport,
    retry,
    replaceImport,
    save,
    stats,
    updateTitle,
  };
}

export const localResumeService = createLocalResumeService();

export function openLocalDatabase(): Promise<LocalDatabase> {
  return openDB<LocalResumeDatabase>(LOCAL_DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(RESUME_STORE)) {
        database.createObjectStore(RESUME_STORE, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        database.createObjectStore(ASSET_STORE);
      }
    },
  });
}

export function listDocuments(
  documents: ResumeDocument[],
  query: LocalResumeListQuery,
): LocalResumeListPayload {
  const normalizedQuery = query.query.trim().toLocaleLowerCase();
  const filtered = documents.filter(
    (document) =>
      (!query.status || document.status === query.status) &&
      (!normalizedQuery || document.title.trim().toLocaleLowerCase().includes(normalizedQuery)),
  );
  filtered.sort((left, right) => compareDocuments(left, right, query.sort));
  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(start, start + query.pageSize).map(toSummary),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  };
}

export function summarizeDocuments(documents: Iterable<ResumeDocument>): LocalResumeStats {
  const stats: LocalResumeStats = { completed: 0, draft: 0, exported: 0, total: 0 };
  for (const document of documents) {
    stats.total += 1;
    stats[document.status] += 1;
    stats.exported += document.exportCount;
  }
  return stats;
}

function createDocument(
  id: string,
  title: string,
  currentTime: Date,
  overrides: Partial<
    Pick<ResumeDocument, 'content' | 'hasAvatar' | 'hasSchoolLogo' | 'profileAlignment'>
  > = {},
): ResumeDocument {
  const timestamp = currentTime.toISOString();
  return {
    id,
    title,
    status: 'draft',
    revision: 1,
    hasAvatar: false,
    hasSchoolLogo: false,
    profileAlignment: 'left',
    exportCount: 0,
    contentVersion: 4,
    content: createDefaultContent(),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function validateDocument(value: unknown): ResumeDocument {
  const document = value as Record<string, unknown>;
  const contentVersion = document?.contentVersion;
  if (
    !document ||
    typeof document.id !== 'string' ||
    !document.id ||
    typeof document.title !== 'string' ||
    (document.status !== 'draft' && document.status !== 'completed') ||
    typeof document.revision !== 'number' ||
    !Number.isInteger(document.revision) ||
    document.revision < 1 ||
    typeof document.hasAvatar !== 'boolean' ||
    (document.hasSchoolLogo !== undefined && typeof document.hasSchoolLogo !== 'boolean') ||
    typeof document.exportCount !== 'number' ||
    !Number.isInteger(document.exportCount) ||
    document.exportCount < 0 ||
    (contentVersion !== 2 && contentVersion !== 3 && contentVersion !== 4) ||
    !isTimestamp(document.createdAt) ||
    !isTimestamp(document.updatedAt)
  ) {
    throw new LocalResumeDataError();
  }
  let profileAlignment;
  try {
    profileAlignment = normalizeProfileAlignment(
      document.profileAlignment ?? document.templateId ?? null,
    );
  } catch {
    throw new LocalResumeDataError();
  }
  return {
    id: document.id,
    title: validateTitle(document.title),
    status: document.status,
    revision: document.revision,
    hasAvatar: document.hasAvatar,
    hasSchoolLogo: document.hasSchoolLogo === true,
    profileAlignment,
    exportCount: document.exportCount,
    contentVersion: 4,
    content: parseResumeContent(document.content, contentVersion),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized || Array.from(normalized).length > TITLE_LIMIT) {
    throw new LocalResumeDataError();
  }
  return normalized;
}

function parseStoredRecord(record: StoredResumeRecord, expectedId?: string): ResumeDocument {
  try {
    const storedDocument = record.document as Record<string, unknown>;
    if (record.storageVersion === 1) {
      if (record.key !== LEGACY_RESUME_KEY || storedDocument.id !== LEGACY_RESUME_ID) {
        throw new LocalResumeDataError();
      }
    } else if (record.storageVersion === 2) {
      if (record.key === LEGACY_RESUME_KEY || record.key !== storedDocument.id) {
        throw new LocalResumeDataError();
      }
    } else {
      throw new LocalResumeDataError();
    }
    const document = validateDocument(record.document);
    if (expectedId && document.id !== expectedId) throw new LocalResumeDataError();
    return document;
  } catch (error) {
    if (error instanceof LocalResumeDataError) throw error;
    throw new LocalResumeDataError();
  }
}

function toRecord(document: ResumeDocument): StoredResumeRecord {
  if (document.id === LEGACY_RESUME_ID) {
    return {
      key: LEGACY_RESUME_KEY,
      storageVersion: 1,
      document: cloneDocument(document),
    };
  }
  return {
    key: document.id,
    storageVersion: 2,
    document: cloneDocument(document),
  };
}

function resumeKey(resumeId: string): string {
  return resumeId === LEGACY_RESUME_ID ? LEGACY_RESUME_KEY : resumeId;
}

function assetKey(resumeId: string): string {
  return resumeId === LEGACY_RESUME_ID ? LEGACY_AVATAR_KEY : `avatar:${resumeId}`;
}

function schoolLogoAssetKey(resumeId: string): string {
  return resumeId === LEGACY_RESUME_ID ? LEGACY_SCHOOL_LOGO_KEY : `school-logo:${resumeId}`;
}

function nextRevision(
  document: ResumeDocument,
  revision: number,
  currentTime: Date,
): ResumeDocument {
  return {
    ...cloneDocument(document),
    revision: revision + 1,
    updatedAt: currentTime.toISOString(),
  };
}

function assertRevision(document: ResumeDocument, expectedRevision: number): void {
  if (document.revision !== expectedRevision) throw new LocalResumeConflictError();
}

async function assertBelowLimit(store: { count(): Promise<number> }): Promise<void> {
  if ((await store.count()) >= LOCAL_RESUME_LIMIT) throw new LocalResumeLimitError();
}

function compareDocuments(
  left: ResumeDocument,
  right: ResumeDocument,
  sort: LocalResumeListQuery['sort'],
): number {
  if (sort === 'updated_asc') return left.updatedAt.localeCompare(right.updatedAt);
  if (sort === 'created_desc') return right.createdAt.localeCompare(left.createdAt);
  if (sort === 'title_asc') {
    return left.title.trim().localeCompare(right.title.trim(), 'zh-CN');
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function toSummary(document: ResumeDocument) {
  return {
    createdAt: document.createdAt,
    exportCount: document.exportCount,
    hasAvatar: document.hasAvatar,
    hasSchoolLogo: document.hasSchoolLogo,
    id: document.id,
    revision: document.revision,
    status: document.status,
    profileAlignment: document.profileAlignment,
    title: document.title,
    updatedAt: document.updatedAt,
  };
}

function copyTitle(title: string): string {
  const suffix = ' - 副本';
  return `${Array.from(title.trim())
    .slice(0, TITLE_LIMIT - Array.from(suffix).length)
    .join('')}${suffix}`;
}

function cloneDocument(document: ResumeDocument): ResumeDocument {
  return structuredClone(document);
}

function dataUrlToBlob(value: string): Blob {
  try {
    const [header, encoded = ''] = value.split(',', 2);
    const match = /^data:([^;]+);base64$/.exec(header);
    if (!match || !encoded) throw new LocalResumeDataError();
    const binary = atob(encoded);
    return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], {
      type: match[1],
    });
  } catch (error) {
    if (error instanceof LocalResumeDataError) throw error;
    throw new LocalResumeDataError();
  }
}

function isLocalResumeDomainError(error: unknown): boolean {
  return (
    error instanceof LocalResumeConflictError ||
    error instanceof LocalResumeDataError ||
    error instanceof LocalResumeLimitError ||
    error instanceof LocalResumeNotFoundError
  );
}
