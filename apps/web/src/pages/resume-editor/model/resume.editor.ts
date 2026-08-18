import type { ResumeDocument, ResumeImportEnvelope } from './resume.types';

export type ResumeEditorMode = 'cloud' | 'local';
export type PersistenceDurability = 'persistent' | 'read-only';

export type ResumeEditorSnapshot = {
  avatar: Blob | null;
  schoolLogo: Blob | null;
  document: ResumeDocument;
  durability: PersistenceDurability;
};

export type ResumeEditorPersistence = {
  deleteAvatar: (document: ResumeDocument) => Promise<ResumeEditorSnapshot>;
  deleteSchoolLogo: (document: ResumeDocument) => Promise<ResumeEditorSnapshot>;
  load: () => Promise<ResumeEditorSnapshot>;
  exportPdf?: (document: ResumeDocument) => Promise<Blob>;
  recordExport?: () => Promise<ResumeDocument>;
  refreshMetadata?: () => Promise<ResumeDocument>;
  overwrite: (document: ResumeDocument) => Promise<ResumeEditorSnapshot>;
  putAvatar: (document: ResumeDocument, avatar: Blob) => Promise<ResumeEditorSnapshot>;
  putSchoolLogo: (document: ResumeDocument, schoolLogo: Blob) => Promise<ResumeEditorSnapshot>;
  replaceImport: (
    envelope: ResumeImportEnvelope,
    document: ResumeDocument,
  ) => Promise<ResumeEditorSnapshot>;
  save: (document: ResumeDocument, expectedRevision: number) => Promise<ResumeEditorSnapshot>;
};
