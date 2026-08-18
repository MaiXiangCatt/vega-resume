import { describe, expect, it, vi } from 'vitest';

import { httpRequest } from '@/shared/http/http.client';

import { resumeEditorService } from './resume-editor.service';

vi.mock('@/shared/http/http.client', () => ({
  httpBlobRequest: vi.fn(),
  httpRequest: vi.fn(),
}));

describe('resume editor service', () => {
  it('uploads the cropped avatar as JPEG bytes', async () => {
    const avatar = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
    vi.mocked(httpRequest).mockRejectedValueOnce(new Error('stop after request capture'));

    await expect(resumeEditorService.putAvatar('resume-1', avatar)).rejects.toThrow(
      'stop after request capture',
    );

    expect(httpRequest).toHaveBeenCalledWith('/api/resumes/resume-1/avatar', {
      body: avatar,
      headers: { 'Content-Type': 'image/jpeg' },
      method: 'PUT',
    });
  });

  it('uploads the cropped school logo as PNG bytes', async () => {
    const schoolLogo = new Blob(['png-bytes'], { type: 'image/png' });
    vi.mocked(httpRequest).mockRejectedValueOnce(new Error('stop after request capture'));

    await expect(resumeEditorService.putSchoolLogo('resume-1', schoolLogo)).rejects.toThrow(
      'stop after request capture',
    );

    expect(httpRequest).toHaveBeenCalledWith('/api/resumes/resume-1/school-logo', {
      body: schoolLogo,
      headers: { 'Content-Type': 'image/png' },
      method: 'PUT',
    });
  });
});
