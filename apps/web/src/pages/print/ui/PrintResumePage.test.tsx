import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultContent } from '@/pages/resume-editor/model/resume.model';
import type { ResumeDocument } from '@/pages/resume-editor/model/resume.types';

import { printService } from '../service/print.service';
import { PrintResumePage } from './PrintResumePage';

vi.mock('../service/print.service', () => ({
  printService: { getPrintData: vi.fn() },
}));

const getPrintData = vi.mocked(printService.getPrintData);

function createResume(): ResumeDocument {
  const content = createDefaultContent();
  content.profile.fullName = '林清清';
  return {
    id: 'resume-1',
    title: '打印简历',
    status: 'draft',
    revision: 1,
    hasAvatar: false,
    hasSchoolLogo: false,
    profileAlignment: 'left',
    exportCount: 0,
    contentVersion: 4,
    content,
    createdAt: '2026-07-22T00:00:00Z',
    updatedAt: '2026-07-22T00:00:00Z',
  };
}

describe('PrintResumePage', () => {
  beforeEach(() => {
    delete document.body.dataset.printReady;
    delete document.body.dataset.printError;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the resume and flags the page ready', async () => {
    getPrintData.mockResolvedValue({ document: createResume(), avatar: null, schoolLogo: null });

    render(<PrintResumePage resumeId="resume-1" token="token-1" />);

    await waitFor(() => {
      expect(document.body.dataset.printReady).toBe('true');
    });
    expect(getPrintData).toHaveBeenCalledWith('resume-1', 'token-1');
    expect(screen.getByLabelText('打印简历 A4 实时预览')).toBeInTheDocument();
    expect(document.body.dataset.printError).toBeUndefined();
    expect(document.querySelector('style')?.textContent).toContain(
      'html, body, #root { background: #fff !important; }',
    );
  });

  it('flags a print error when loading fails', async () => {
    getPrintData.mockRejectedValue(new Error('token 无效'));

    render(<PrintResumePage resumeId="resume-1" token="bad-token" />);

    await waitFor(() => {
      expect(document.body.dataset.printError).toBe('token 无效');
    });
    expect(document.body.dataset.printReady).toBeUndefined();
  });

  it('uses a generic document title when the profile is hidden', async () => {
    const resume = createResume();
    resume.content.profile.enabled = false;
    getPrintData.mockResolvedValue({ document: resume, avatar: null, schoolLogo: null });

    const view = render(<PrintResumePage resumeId="resume-1" token="token-1" />);

    await waitFor(() => {
      expect(document.body.dataset.printReady).toBe('true');
    });
    expect(document.title).toBe('简历');

    view.unmount();
    expect(document.title).not.toBe('简历');
  });
});
