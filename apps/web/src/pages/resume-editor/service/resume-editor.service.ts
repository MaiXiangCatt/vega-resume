import type { ResumeDetail } from '@/shared/api/generated/model/resumeDetail';
import type { ResumeContent } from '@/shared/api/generated/model/resumeContent';
import { httpBlobRequest, httpRequest } from '@/shared/http/http.client';

import type { ResumeDocument, ResumeImportEnvelope, ResumeStatus } from '../model/resume.types';
import { normalizeProfileAlignment, parseResumeContent } from '../model/resume.model';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class UnsupportedResumeContentError extends Error {
  constructor() {
    super('这份简历使用旧版内容格式，请删除后重新创建');
    this.name = 'UnsupportedResumeContentError';
  }
}

export function toDocument(detail: ResumeDetail): ResumeDocument {
  if (detail.contentVersion !== 2 && detail.contentVersion !== 3 && detail.contentVersion !== 4)
    throw new UnsupportedResumeContentError();
  const compatible = detail as ResumeDetail & {
    profileAlignment?: string | null;
    templateId?: string | null;
  };
  return {
    id: detail.id,
    title: detail.title,
    status: detail.status as ResumeStatus,
    revision: detail.revision,
    hasAvatar: detail.hasAvatar,
    hasSchoolLogo: detail.hasSchoolLogo,
    profileAlignment: normalizeProfileAlignment(
      compatible.profileAlignment ?? compatible.templateId,
    ),
    exportCount: detail.exportCount,
    contentVersion: 4,
    content: parseResumeContent(detail.content, detail.contentVersion),
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

export const resumeEditorService = {
  async get(resumeId: string) {
    return toDocument(await httpRequest<ResumeDetail>(`/api/resumes/${resumeId}`));
  },

  async update(document: ResumeDocument, expectedRevision = document.revision) {
    const detail = await httpRequest<ResumeDetail>(`/api/resumes/${document.id}`, {
      body: JSON.stringify({
        expectedRevision,
        title: document.title,
        status: document.status,
        profileAlignment: document.profileAlignment,
        contentVersion: 4,
        content: document.content as unknown as ResumeContent,
      }),
      headers: JSON_HEADERS,
      method: 'PATCH',
    });
    return toDocument(detail);
  },

  async replaceImport(resumeId: string, revision: number, envelope: ResumeImportEnvelope) {
    const detail = await httpRequest<ResumeDetail>(`/api/resumes/${resumeId}/import`, {
      body: JSON.stringify({ ...envelope, expectedRevision: revision }),
      headers: JSON_HEADERS,
      method: 'PUT',
    });
    return toDocument(detail);
  },

  async putAvatar(resumeId: string, avatar: Blob) {
    const detail = await httpRequest<ResumeDetail>(`/api/resumes/${resumeId}/avatar`, {
      body: avatar,
      headers: { 'Content-Type': 'image/jpeg' },
      method: 'PUT',
    });
    return toDocument(detail);
  },

  async getAvatar(resumeId: string) {
    return httpBlobRequest(`/api/resumes/${resumeId}/avatar`);
  },

  async deleteAvatar(resumeId: string) {
    const detail = await httpRequest<ResumeDetail>(`/api/resumes/${resumeId}/avatar`, {
      method: 'DELETE',
    });
    return toDocument(detail);
  },

  async putSchoolLogo(resumeId: string, schoolLogo: Blob) {
    const detail = await httpRequest<ResumeDetail>(`/api/resumes/${resumeId}/school-logo`, {
      body: schoolLogo,
      headers: { 'Content-Type': 'image/png' },
      method: 'PUT',
    });
    return toDocument(detail);
  },

  async getSchoolLogo(resumeId: string) {
    return httpBlobRequest(`/api/resumes/${resumeId}/school-logo`);
  },

  async deleteSchoolLogo(resumeId: string) {
    const detail = await httpRequest<ResumeDetail>(`/api/resumes/${resumeId}/school-logo`, {
      method: 'DELETE',
    });
    return toDocument(detail);
  },

  async exportPdf(resumeId: string) {
    return httpBlobRequest(`/api/resumes/${resumeId}/export/pdf`, { method: 'POST' });
  },
};
