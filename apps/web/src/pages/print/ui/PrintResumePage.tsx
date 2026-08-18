import { useEffect, useState } from 'react';

import type { ResumeDocument } from '@/pages/resume-editor/model/resume.types';
import { ResumeHtmlPreview } from '@/pages/resume-editor/ui/ResumeHtmlPreview';

import { printService } from '../service/print.service';

type PrintState =
  | { status: 'loading' }
  | {
      status: 'ready';
      document: ResumeDocument;
      avatar: string | null;
      schoolLogo: string | null;
    }
  | { status: 'error'; message: string };

export function PrintResumePage({ resumeId, token }: { resumeId: string; token: string }) {
  const [state, setState] = useState<PrintState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    printService
      .getPrintData(resumeId, token)
      .then(({ document: doc, avatar, schoolLogo }) => {
        if (!cancelled) setState({ status: 'ready', document: doc, avatar, schoolLogo });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : '加载失败',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, token]);

  useEffect(() => {
    if (state.status === 'error') {
      document.body.dataset.printError = state.message;
      return;
    }
    if (state.status !== 'ready') return;
    let cancelled = false;
    void (async () => {
      try {
        await (document.fonts?.ready ?? Promise.resolve());
        await Promise.all(
          Array.from(document.images).map((image) => image.decode().catch(() => undefined)),
        );
      } finally {
        if (!cancelled) document.body.dataset.printReady = 'true';
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const previousTitle = document.title;
    document.title = state.document.content.profile.enabled ? state.document.title : '简历';
    return () => {
      document.title = previousTitle;
    };
  }, [state]);

  if (state.status !== 'ready') {
    return null;
  }

  const margin = state.document.content.formatting.pageMarginPx;
  return (
    <>
      <style>{`
        @page { size: A4; margin: ${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px; }
        html, body, #root { background: #fff !important; }
      `}</style>
      <ResumeHtmlPreview
        avatar={state.avatar}
        mode="print"
        resume={state.document}
        schoolLogo={state.schoolLogo}
      />
    </>
  );
}
