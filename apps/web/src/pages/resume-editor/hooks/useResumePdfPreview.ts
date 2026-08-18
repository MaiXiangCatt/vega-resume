import { useCallback, useEffect, useRef, useState } from 'react';

import type { ResumeDocument } from '../model/resume.types';

export type ResumePdfAsset = {
  blob: Blob;
  key: string;
};

type PdfPreviewStatus = 'idle' | 'generating' | 'loading' | 'ready' | 'error';

type PdfInput = {
  avatar: string | null;
  schoolLogo: string | null;
  document: ResumeDocument;
  key: string;
};

export function useResumePdfPreview({
  active,
  avatar,
  avatarRevision,
  schoolLogo = null,
  schoolLogoRevision = 0,
  document,
  documentVersion = document?.revision ?? 0,
}: {
  active: boolean;
  avatar: string | null;
  avatarRevision: number;
  schoolLogo?: string | null;
  schoolLogoRevision?: number;
  document: ResumeDocument | null;
  documentVersion?: number;
}) {
  const [current, setCurrent] = useState<ResumePdfAsset | null>(null);
  const [pending, setPending] = useState<ResumePdfAsset | null>(null);
  const [status, setStatus] = useState<PdfPreviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'generation' | 'render' | null>(null);
  const [generationTick, setGenerationTick] = useState(0);
  const [renderRevision, setRenderRevision] = useState(0);
  const currentRef = useRef<ResumePdfAsset | null>(null);
  const pendingRef = useRef<ResumePdfAsset | null>(null);
  const latestInputRef = useRef<PdfInput | null>(null);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef<Promise<Blob> | null>(null);
  const runningKeyRef = useRef<string | null>(null);
  const queuedRef = useRef(false);
  const generatedOnceRef = useRef(false);

  const publish = useCallback((blob: Blob, key: string) => {
    const next = { blob, key };
    pendingRef.current = next;
    setPending(next);
    setStatus('loading');
    setError(null);
    setErrorKind(null);
  }, []);

  const generate = useCallback(
    async (input: PdfInput): Promise<Blob> => {
      if (pendingRef.current?.key === input.key) return pendingRef.current.blob;
      if (currentRef.current?.key === input.key) return currentRef.current.blob;
      if (runningRef.current) {
        if (runningKeyRef.current === input.key) return runningRef.current;
        queuedRef.current = true;
        return runningRef.current;
      }

      setStatus('generating');
      setError(null);
      runningKeyRef.current = input.key;
      const operation = import('../service/resume-pdf.service')
        .then(({ createResumePdfBlob }) =>
          createResumePdfBlob(input.document, input.avatar, input.schoolLogo),
        )
        .then((blob) => {
          generatedOnceRef.current = true;
          if (latestInputRef.current?.key === input.key) publish(blob, input.key);
          return blob;
        })
        .catch((generationError: unknown) => {
          setStatus(currentRef.current ? 'ready' : 'error');
          setError(generationError instanceof Error ? generationError.message : 'PDF 预览生成失败');
          setErrorKind('generation');
          throw generationError;
        })
        .finally(() => {
          runningRef.current = null;
          runningKeyRef.current = null;
          if (queuedRef.current) {
            queuedRef.current = false;
            setGenerationTick((tick) => tick + 1);
          }
        });
      runningRef.current = operation;
      return operation;
    },
    [publish],
  );

  useEffect(() => {
    if (!active || !document) return;
    const input = {
      avatar,
      schoolLogo,
      document: structuredClone(document),
      key: `${documentVersion}:${avatarRevision}:${schoolLogoRevision}`,
    };
    latestInputRef.current = input;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => void generate(input).catch(() => undefined),
      generatedOnceRef.current ? 800 : 0,
    );
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [
    active,
    avatar,
    avatarRevision,
    document,
    documentVersion,
    generate,
    generationTick,
    schoolLogo,
    schoolLogoRevision,
  ]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const commitPending = useCallback((key: string) => {
    const next = pendingRef.current;
    if (!next || next.key !== key) return;
    currentRef.current = next;
    pendingRef.current = null;
    setCurrent(next);
    setPending(null);
    setStatus('ready');
    setError(null);
    setErrorKind(null);
  }, []);

  const reportRenderError = useCallback((key: string, renderError: unknown) => {
    if (pendingRef.current?.key !== key && currentRef.current?.key !== key) return;
    setStatus('error');
    setError(renderError instanceof Error ? renderError.message : 'PDF 预览绘制失败');
    setErrorKind('render');
  }, []);

  const retry = useCallback(() => {
    if (!latestInputRef.current) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (errorKind === 'render' && (pendingRef.current || currentRef.current)) {
      setError(null);
      setErrorKind(null);
      setStatus(pendingRef.current ? 'loading' : 'ready');
      setRenderRevision((revision) => revision + 1);
      return;
    }
    void generate(latestInputRef.current).catch(() => undefined);
  }, [errorKind, generate]);

  const getLatestBlob = useCallback(async () => {
    const input = latestInputRef.current;
    if (!input) throw new Error('简历尚未加载');
    if (pendingRef.current?.key === input.key) return pendingRef.current.blob;
    if (currentRef.current?.key === input.key) return currentRef.current.blob;
    if (runningRef.current) {
      await runningRef.current.catch(() => undefined);
      if (pendingRef.current?.key === input.key) return pendingRef.current.blob;
      if (currentRef.current?.key === input.key) return currentRef.current.blob;
    }
    return generate(input);
  }, [generate]);

  return {
    commitPending,
    current,
    error,
    getLatestBlob,
    pending,
    renderRevision,
    reportRenderError,
    retry,
    status,
  };
}

export type ResumePdfPreviewController = ReturnType<typeof useResumePdfPreview>;
