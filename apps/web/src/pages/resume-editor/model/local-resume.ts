import type { ResumeDocument, ResumeImportEnvelope, ResumeStatus } from './resume.types';

export const LOCAL_RESUME_LIMIT = 20;

export type LocalResumePageSize = 6 | 12 | 24;
export type LocalResumeSort = 'updated_desc' | 'updated_asc' | 'created_desc' | 'title_asc';

export type LocalResumeListQuery = {
  page: number;
  pageSize: LocalResumePageSize;
  query: string;
  sort: LocalResumeSort;
  status?: ResumeStatus;
};

export type LocalResumeSummary = Pick<
  ResumeDocument,
  | 'createdAt'
  | 'exportCount'
  | 'hasAvatar'
  | 'hasSchoolLogo'
  | 'id'
  | 'revision'
  | 'status'
  | 'profileAlignment'
  | 'title'
  | 'updatedAt'
>;

export type LocalResumeListPayload = {
  items: LocalResumeSummary[];
  page: number;
  pageSize: LocalResumePageSize;
  total: number;
};

export type LocalResumeStats = {
  completed: number;
  draft: number;
  exported: number;
  total: number;
};

export type LocalResumeLibrarySnapshot = {
  avatars: Map<string, Blob>;
  schoolLogos: Map<string, Blob>;
  documents: Map<string, ResumeDocument>;
};

export type LocalResumeRepository = {
  clear(): Promise<void>;
  copy(resumeId: string): Promise<ResumeDocument>;
  create(title?: string): Promise<ResumeDocument>;
  delete(resumeId: string): Promise<void>;
  deleteAvatar(document: ResumeDocument): Promise<ResumeDocument>;
  deleteSchoolLogo(document: ResumeDocument): Promise<ResumeDocument>;
  get(resumeId: string): Promise<{
    avatar: Blob | null;
    schoolLogo: Blob | null;
    document: ResumeDocument;
  }>;
  has(resumeId: string): Promise<boolean>;
  import(envelope: ResumeImportEnvelope): Promise<ResumeDocument>;
  list(query: LocalResumeListQuery): Promise<LocalResumeListPayload>;
  loadLibrary(): Promise<LocalResumeLibrarySnapshot>;
  overwrite(document: ResumeDocument): Promise<ResumeDocument>;
  putAvatar(document: ResumeDocument, avatar: Blob): Promise<ResumeDocument>;
  putSchoolLogo(document: ResumeDocument, schoolLogo: Blob): Promise<ResumeDocument>;
  recordExport(resumeId: string): Promise<ResumeDocument>;
  retry(): Promise<LocalResumeLibrarySnapshot>;
  replaceImport(
    resumeId: string,
    expectedRevision: number,
    envelope: ResumeImportEnvelope,
  ): Promise<ResumeDocument>;
  save(document: ResumeDocument, expectedRevision: number): Promise<ResumeDocument>;
  stats(): Promise<LocalResumeStats>;
  updateTitle(resumeId: string, expectedRevision: number, title: string): Promise<ResumeDocument>;
};
