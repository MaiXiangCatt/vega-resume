import type {
  LocalResumeLibrarySnapshot,
  LocalResumeListPayload,
  LocalResumeListQuery,
  LocalResumeStats,
} from '../model/local-resume';
import type { ResumeDocument, ResumeImportEnvelope } from '../model/resume.types';
import {
  listDocuments,
  localResumeService,
  LocalResumeConflictError,
  LocalResumeStorageError,
  summarizeDocuments,
} from '../service/local-resume.service';

export type LocalStorageAvailability = 'idle' | 'persistent' | 'read-only' | 'blocked';

export type LocalResumeStoreSnapshot = {
  availability: LocalStorageAvailability;
  error: string | null;
  revision: number;
};

type Listener = () => void;

class LocalResumeStore {
  private avatars = new Map<string, Blob>();
  private schoolLogos = new Map<string, Blob>();
  private documents = new Map<string, ResumeDocument>();
  private initialized = false;
  private listeners = new Set<Listener>();
  private snapshot: LocalResumeStoreSnapshot = {
    availability: 'idle',
    error: null,
    revision: 0,
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LocalResumeStoreSnapshot => this.snapshot;

  async initialize(force = false): Promise<void> {
    if (this.initialized && !force) return;
    try {
      this.replaceLibrary(
        await (force ? localResumeService.retry() : localResumeService.loadLibrary()),
      );
      this.initialized = true;
      this.setAvailability('persistent', null);
    } catch (error) {
      if (this.initialized) {
        this.markReadOnly(error);
      } else {
        this.setAvailability('blocked', errorMessage(error));
      }
      throw error;
    }
  }

  async retry(): Promise<void> {
    await this.initialize(true);
  }

  async clear(): Promise<void> {
    await localResumeService.clear();
    this.documents.clear();
    this.avatars.clear();
    this.schoolLogos.clear();
    this.initialized = false;
    this.setAvailability('idle', null);
  }

  async has(resumeId: string): Promise<boolean> {
    if (this.initialized) return this.documents.has(resumeId);
    try {
      return await localResumeService.has(resumeId);
    } catch {
      return false;
    }
  }

  async list(query: LocalResumeListQuery): Promise<LocalResumeListPayload> {
    await this.initialize();
    return listDocuments([...this.documents.values()], query);
  }

  async stats(): Promise<LocalResumeStats> {
    await this.initialize();
    return summarizeDocuments(this.documents.values());
  }

  async get(resumeId: string): Promise<{
    avatar: Blob | null;
    schoolLogo: Blob | null;
    document: ResumeDocument;
  }> {
    if (this.snapshot.availability === 'read-only') {
      return this.cachedResume(resumeId);
    }
    try {
      const result = await localResumeService.get(resumeId);
      this.remember(result.document, result.avatar, result.schoolLogo);
      this.initialized = true;
      this.setAvailability('persistent', null);
      return cloneResult(result);
    } catch (error) {
      if (error instanceof LocalResumeStorageError) {
        if (this.initialized && this.documents.has(resumeId)) {
          this.markReadOnly(error);
          return this.cachedResume(resumeId);
        }
        this.setAvailability('blocked', errorMessage(error));
      }
      throw error;
    }
  }

  cachedSnapshot(resumeId: string): {
    avatar: Blob | null;
    schoolLogo: Blob | null;
    document: ResumeDocument;
  } {
    return this.cachedResume(resumeId);
  }

  async reconnect(
    resumeId: string,
    expectedRevision: number,
  ): Promise<{ avatar: Blob | null; schoolLogo: Blob | null; document: ResumeDocument }> {
    try {
      const result = await localResumeService.get(resumeId);
      if (result.document.revision !== expectedRevision) {
        throw new LocalResumeConflictError();
      }
      this.remember(result.document, result.avatar, result.schoolLogo);
      this.initialized = true;
      this.setAvailability('persistent', null);
      return cloneResult(result);
    } catch (error) {
      if (error instanceof LocalResumeStorageError) this.markReadOnly(error);
      if (error instanceof LocalResumeConflictError) this.markReadOnly(error);
      throw error;
    }
  }

  async create(title?: string): Promise<ResumeDocument> {
    return this.runWrite(
      () => localResumeService.create(title),
      async (document) => this.remember(document, null, null),
    );
  }

  async import(envelope: ResumeImportEnvelope): Promise<ResumeDocument> {
    return this.runWrite(
      () => localResumeService.import(envelope),
      async (document) =>
        this.remember(
          document,
          envelope.avatar ? dataUrlToBlob(envelope.avatar) : null,
          envelope.schoolLogo ? dataUrlToBlob(envelope.schoolLogo) : null,
        ),
    );
  }

  async copy(resumeId: string): Promise<ResumeDocument> {
    return this.runWrite(
      () => localResumeService.copy(resumeId),
      async (document) =>
        this.remember(
          document,
          this.avatars.get(resumeId) ?? null,
          this.schoolLogos.get(resumeId) ?? null,
        ),
    );
  }

  async updateTitle(
    resumeId: string,
    expectedRevision: number,
    title: string,
  ): Promise<ResumeDocument> {
    return this.runWrite(
      () => localResumeService.updateTitle(resumeId, expectedRevision, title),
      async (document) =>
        this.remember(
          document,
          this.avatars.get(resumeId) ?? null,
          this.schoolLogos.get(resumeId) ?? null,
        ),
    );
  }

  async delete(resumeId: string): Promise<void> {
    await this.runWrite(
      () => localResumeService.delete(resumeId),
      async () => {
        this.documents.delete(resumeId);
        this.avatars.delete(resumeId);
        this.schoolLogos.delete(resumeId);
        this.emit();
      },
    );
  }

  async save(document: ResumeDocument, expectedRevision: number): Promise<ResumeDocument> {
    try {
      return await this.runWrite(
        () => localResumeService.save(document, expectedRevision),
        async (saved) =>
          this.remember(
            saved,
            this.avatars.get(document.id) ?? null,
            this.schoolLogos.get(document.id) ?? null,
          ),
      );
    } catch (error) {
      if (error instanceof LocalResumeStorageError) {
        this.remember(
          document,
          this.avatars.get(document.id) ?? null,
          this.schoolLogos.get(document.id) ?? null,
        );
      }
      throw error;
    }
  }

  async overwrite(document: ResumeDocument): Promise<ResumeDocument> {
    return this.runWrite(
      () => localResumeService.overwrite(document),
      async (saved) =>
        this.remember(
          saved,
          this.avatars.get(document.id) ?? null,
          this.schoolLogos.get(document.id) ?? null,
        ),
    );
  }

  async replaceImport(
    resumeId: string,
    expectedRevision: number,
    envelope: ResumeImportEnvelope,
  ): Promise<ResumeDocument> {
    return this.runWrite(
      () => localResumeService.replaceImport(resumeId, expectedRevision, envelope),
      async (document) =>
        this.remember(
          document,
          envelope.avatar ? dataUrlToBlob(envelope.avatar) : null,
          envelope.schoolLogo ? dataUrlToBlob(envelope.schoolLogo) : null,
        ),
    );
  }

  async putAvatar(document: ResumeDocument, avatar: Blob): Promise<ResumeDocument> {
    try {
      return await this.runWrite(
        () => localResumeService.putAvatar(document, avatar),
        async (saved) => this.remember(saved, avatar, this.schoolLogos.get(document.id) ?? null),
      );
    } catch (error) {
      if (error instanceof LocalResumeStorageError) {
        this.remember(
          { ...document, hasAvatar: true },
          avatar,
          this.schoolLogos.get(document.id) ?? null,
        );
      }
      throw error;
    }
  }

  async deleteAvatar(document: ResumeDocument): Promise<ResumeDocument> {
    try {
      return await this.runWrite(
        () => localResumeService.deleteAvatar(document),
        async (saved) => this.remember(saved, null, this.schoolLogos.get(document.id) ?? null),
      );
    } catch (error) {
      if (error instanceof LocalResumeStorageError) {
        this.remember(
          { ...document, hasAvatar: false },
          null,
          this.schoolLogos.get(document.id) ?? null,
        );
      }
      throw error;
    }
  }

  async putSchoolLogo(document: ResumeDocument, schoolLogo: Blob): Promise<ResumeDocument> {
    try {
      return await this.runWrite(
        () => localResumeService.putSchoolLogo(document, schoolLogo),
        async (saved) => this.remember(saved, this.avatars.get(document.id) ?? null, schoolLogo),
      );
    } catch (error) {
      if (error instanceof LocalResumeStorageError) {
        this.remember(
          { ...document, hasSchoolLogo: true },
          this.avatars.get(document.id) ?? null,
          schoolLogo,
        );
      }
      throw error;
    }
  }

  async deleteSchoolLogo(document: ResumeDocument): Promise<ResumeDocument> {
    try {
      return await this.runWrite(
        () => localResumeService.deleteSchoolLogo(document),
        async (saved) => this.remember(saved, this.avatars.get(document.id) ?? null, null),
      );
    } catch (error) {
      if (error instanceof LocalResumeStorageError) {
        this.remember(
          { ...document, hasSchoolLogo: false },
          this.avatars.get(document.id) ?? null,
          null,
        );
      }
      throw error;
    }
  }

  async recordExport(resumeId: string): Promise<ResumeDocument> {
    return this.runWrite(
      () => localResumeService.recordExport(resumeId),
      async (document) =>
        this.remember(
          document,
          this.avatars.get(resumeId) ?? null,
          this.schoolLogos.get(resumeId) ?? null,
        ),
    );
  }

  private async runWrite<T>(
    operation: () => Promise<T>,
    remember: (result: T) => Promise<void>,
  ): Promise<T> {
    try {
      const result = await operation();
      await remember(result);
      this.initialized = true;
      this.setAvailability('persistent', null);
      return result;
    } catch (error) {
      if (error instanceof LocalResumeStorageError) this.markReadOnly(error);
      throw error;
    }
  }

  private cachedResume(resumeId: string): {
    avatar: Blob | null;
    schoolLogo: Blob | null;
    document: ResumeDocument;
  } {
    const document = this.documents.get(resumeId);
    if (!document) throw new Error('这份本地简历不存在或已被删除');
    return {
      avatar: this.avatars.get(resumeId) ?? null,
      schoolLogo: this.schoolLogos.get(resumeId) ?? null,
      document: structuredClone(document),
    };
  }

  private remember(document: ResumeDocument, avatar: Blob | null, schoolLogo: Blob | null): void {
    this.documents.set(document.id, structuredClone(document));
    if (avatar) this.avatars.set(document.id, avatar);
    else this.avatars.delete(document.id);
    if (schoolLogo) this.schoolLogos.set(document.id, schoolLogo);
    else this.schoolLogos.delete(document.id);
    this.emit();
  }

  private replaceLibrary(library: LocalResumeLibrarySnapshot): void {
    this.documents = new Map(
      [...library.documents].map(([id, document]) => [id, structuredClone(document)]),
    );
    this.avatars = new Map(library.avatars);
    this.schoolLogos = new Map(library.schoolLogos);
    this.emit();
  }

  private markReadOnly(error: unknown): void {
    this.setAvailability('read-only', errorMessage(error));
  }

  private setAvailability(availability: LocalStorageAvailability, error: string | null): void {
    if (this.snapshot.availability === availability && this.snapshot.error === error) return;
    this.snapshot = {
      availability,
      error,
      revision: this.snapshot.revision + 1,
    };
    this.notify();
  }

  private emit(): void {
    this.snapshot = { ...this.snapshot, revision: this.snapshot.revision + 1 };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function cloneResult(result: {
  avatar: Blob | null;
  schoolLogo: Blob | null;
  document: ResumeDocument;
}): {
  avatar: Blob | null;
  schoolLogo: Blob | null;
  document: ResumeDocument;
} {
  return {
    avatar: result.avatar,
    schoolLogo: result.schoolLogo,
    document: structuredClone(result.document),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '浏览器本地存储暂时不可用';
}

function dataUrlToBlob(value: string): Blob {
  const [header, encoded = ''] = value.split(',', 2);
  const mime = /^data:([^;]+);base64$/.exec(header)?.[1] ?? 'application/octet-stream';
  const binary = atob(encoded);
  return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], {
    type: mime,
  });
}

export const localResumeStore = new LocalResumeStore();
