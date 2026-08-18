import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultContent } from '../model/resume.model';
import type { ResumeDocument } from '../model/resume.types';
import { useResumePdfPreview } from './useResumePdfPreview';

const pdfMock = vi.hoisted(() => ({
  createResumePdfBlob: vi.fn<(document: ResumeDocument, avatar: string | null) => Promise<Blob>>(),
}));

vi.mock('../service/resume-pdf.service', () => pdfMock);

function createDocument(revision: number, title = `简历 ${revision}`): ResumeDocument {
  return {
    id: 'guest-primary',
    title,
    status: 'draft',
    revision,
    hasAvatar: false,
    hasSchoolLogo: false,
    profileAlignment: 'left',
    exportCount: 0,
    contentVersion: 4,
    content: createDefaultContent(),
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
  };
}

describe('useResumePdfPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pdfMock.createResumePdfBlob.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('generates immediately, then waits 800ms and keeps the old preview until commit', async () => {
    pdfMock.createResumePdfBlob
      .mockResolvedValueOnce(new Blob(['first'], { type: 'application/pdf' }))
      .mockResolvedValueOnce(new Blob(['second'], { type: 'application/pdf' }));
    const { result, rerender } = renderHook(
      ({ document }) =>
        useResumePdfPreview({ active: true, avatar: null, avatarRevision: 0, document }),
      { initialProps: { document: createDocument(1) } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.pending?.key).toBe('1:0:0');
    act(() => result.current.commitPending('1:0:0'));
    expect(result.current.current?.key).toBe('1:0:0');

    rerender({ document: createDocument(2) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    expect(pdfMock.createResumePdfBlob).toHaveBeenCalledTimes(1);
    expect(result.current.current?.key).toBe('1:0:0');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(result.current.pending?.key).toBe('2:0:0');
    expect(result.current.current?.key).toBe('1:0:0');
  });

  it('coalesces changes made during generation and ignores the stale result', async () => {
    let resolveFirst: ((blob: Blob) => void) | undefined;
    pdfMock.createResumePdfBlob
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(new Blob(['latest'], { type: 'application/pdf' }));

    const { result, rerender } = renderHook(
      ({ document }) =>
        useResumePdfPreview({ active: true, avatar: null, avatarRevision: 0, document }),
      { initialProps: { document: createDocument(1) } },
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    rerender({ document: createDocument(2) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    rerender({ document: createDocument(3) });
    await act(async () => {
      resolveFirst?.(new Blob(['stale'], { type: 'application/pdf' }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(800);
      await Promise.resolve();
    });

    expect(result.current.pending?.key).toBe('3:0:0');
    expect(pdfMock.createResumePdfBlob).toHaveBeenCalledTimes(2);
    expect(result.current.pending?.key).not.toBe('1:0:0');
  });

  it('ignores stale canvas commits and retries render errors without regenerating the PDF', async () => {
    pdfMock.createResumePdfBlob.mockResolvedValueOnce(
      new Blob(['first'], { type: 'application/pdf' }),
    );
    const { result } = renderHook(() =>
      useResumePdfPreview({
        active: true,
        avatar: null,
        avatarRevision: 0,
        document: createDocument(1),
      }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    act(() => result.current.commitPending('stale-key'));
    expect(result.current.current).toBeNull();

    act(() => result.current.reportRenderError('1:0:0', new Error('canvas failed')));
    expect(result.current.error).toBe('canvas failed');
    const previousRevision = result.current.renderRevision;
    act(() => result.current.retry());
    expect(result.current.renderRevision).toBe(previousRevision + 1);
    expect(pdfMock.createResumePdfBlob).toHaveBeenCalledTimes(1);
    expect(result.current.pending?.key).toBe('1:0:0');
  });

  it('reuses a matching preview blob for export and regenerates a stale one', async () => {
    const first = new Blob(['first'], { type: 'application/pdf' });
    const latest = new Blob(['latest'], { type: 'application/pdf' });
    pdfMock.createResumePdfBlob.mockResolvedValueOnce(first).mockResolvedValueOnce(latest);
    const { result, rerender } = renderHook(
      ({ document }) =>
        useResumePdfPreview({ active: true, avatar: null, avatarRevision: 0, document }),
      { initialProps: { document: createDocument(1) } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(await result.current.getLatestBlob()).toBe(first);

    rerender({ document: createDocument(2) });
    await act(async () => {
      expect(await result.current.getLatestBlob()).toBe(latest);
    });
    expect(pdfMock.createResumePdfBlob).toHaveBeenCalledTimes(2);
  });
});
