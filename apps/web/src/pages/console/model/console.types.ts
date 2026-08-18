import type {
  ProfileAlignment,
  ResumeImportEnvelope,
  ResumeStatus,
} from '@/pages/resume-editor/model/resume.types';

export type ConsoleStatusFilter = 'all' | ResumeStatus;
export type ConsoleSort = 'updated_desc' | 'updated_asc' | 'created_desc' | 'title_asc';
export type ConsolePageSize = 6 | 12 | 24;

export type ConsoleQueryState = {
  page: number;
  pageSize: ConsolePageSize;
  query: string;
  sort: ConsoleSort;
  status: ConsoleStatusFilter;
};

export type Feedback = {
  kind: 'error' | 'info' | 'success';
  message: string;
};

export type ConsoleResumeSummary = {
  createdAt: string;
  exportCount: number;
  hasAvatar: boolean;
  hasSchoolLogo: boolean;
  id: string;
  revision: number;
  status: ResumeStatus;
  profileAlignment: ProfileAlignment;
  title: string;
  updatedAt: string;
};

export type ConsoleResumeList = {
  items: ConsoleResumeSummary[];
  page: number;
  pageSize: ConsolePageSize;
  total: number;
};

export type ConsoleResumeStats = {
  completed: number;
  draft: number;
  exported: number;
  total: number;
};

export type ConsoleDataSource = {
  copy(resumeId: string): Promise<ConsoleResumeSummary>;
  create(title?: string): Promise<ConsoleResumeSummary>;
  delete(resumeId: string): Promise<null | void>;
  import(input: ResumeImportEnvelope): Promise<ConsoleResumeSummary>;
  list(
    query: {
      page: number;
      pageSize: ConsolePageSize;
      query: string;
      sort: ConsoleSort;
      status?: ResumeStatus;
    },
    signal?: AbortSignal,
  ): Promise<ConsoleResumeList>;
  stats(signal?: AbortSignal): Promise<ConsoleResumeStats>;
  updateTitle(
    resumeId: string,
    expectedRevision: number,
    title: string,
  ): Promise<ConsoleResumeSummary>;
};
