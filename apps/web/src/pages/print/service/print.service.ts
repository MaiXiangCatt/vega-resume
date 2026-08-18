import type { ResumePrintPayload } from '@/shared/api/generated/model/resumePrintPayload';
import { httpRequest } from '@/shared/http/http.client';

import type { ResumeDocument } from '@/pages/resume-editor/model/resume.types';
import { toDocument } from '@/pages/resume-editor/service/resume-editor.service';

type PrintData = {
  document: ResumeDocument;
  avatar: string | null;
  schoolLogo: string | null;
};

const inFlightRequests = new Map<string, Promise<PrintData>>();

function getPrintData(resumeId: string, token: string): Promise<PrintData> {
  const requestKey = `${resumeId}:${token}`;
  const existingRequest = inFlightRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = loadPrintData(resumeId, token);
  inFlightRequests.set(requestKey, request);
  const clearRequest = () => {
    if (inFlightRequests.get(requestKey) === request) {
      inFlightRequests.delete(requestKey);
    }
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export const printService = {
  getPrintData,
};

async function loadPrintData(resumeId: string, token: string): Promise<PrintData> {
  const payload = await httpRequest<ResumePrintPayload>(`/api/resumes/${resumeId}/print`, {
    headers: { 'X-Print-Token': token },
    skipAuth: true,
    skipRefreshRetry: true,
  });
  return {
    document: toDocument(payload.resume),
    avatar: payload.avatarDataUrl ?? null,
    schoolLogo: payload.schoolLogoDataUrl ?? null,
  };
}
