import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultContent } from '@/pages/resume-editor/model/resume.model';
import { httpRequest } from '@/shared/http/http.client';

import { printService } from './print.service';

vi.mock('@/shared/http/http.client', () => ({
  httpRequest: vi.fn(),
}));

const request = vi.mocked(httpRequest);
const printPayload = {
  avatarDataUrl: null,
  schoolLogoDataUrl: null,
  resume: {
    id: 'resume-1',
    title: '测试简历',
    status: 'draft' as const,
    revision: 1,
    hasAvatar: false,
    hasSchoolLogo: false,
    profileAlignment: 'left' as const,
    templateId: 'modern-editorial',
    exportCount: 0,
    contentVersion: 4 as const,
    content: createDefaultContent(),
    createdAt: '2026-07-22T00:00:00Z',
    updatedAt: '2026-07-22T00:00:00Z',
  },
};

describe('printService', () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue(printPayload);
  });

  it('sends the one-time print token in a header instead of the URL', async () => {
    await printService.getPrintData('resume-1', 'print-secret');

    expect(request).toHaveBeenCalledWith('/api/resumes/resume-1/print', {
      headers: { 'X-Print-Token': 'print-secret' },
      skipAuth: true,
      skipRefreshRetry: true,
    });
  });

  it('deduplicates concurrent loads for React StrictMode', async () => {
    let resolveRequest: (value: typeof printPayload) => void = () => undefined;
    const pendingRequest = new Promise<typeof printPayload>((resolve) => {
      resolveRequest = resolve;
    });
    request.mockReturnValue(pendingRequest);

    const first = printService.getPrintData('resume-1', 'strict-mode-token');
    const second = printService.getPrintData('resume-1', 'strict-mode-token');

    expect(request).toHaveBeenCalledTimes(1);
    resolveRequest(printPayload);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
});
