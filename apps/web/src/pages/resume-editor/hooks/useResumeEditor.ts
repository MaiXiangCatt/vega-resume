import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '@/shared/http/http.client';

import type { ResumeEditorMode, ResumeEditorSnapshot } from '../model/resume.editor';
import type { ResumeDocument, ResumeImportEnvelope } from '../model/resume.types';
import { LocalResumeConflictError, LocalResumeStorageError } from '../service/local-resume.service';
import { UnsupportedResumeContentError } from '../service/resume-editor.service';
import { createResumePersistence } from '../service/resume-persistence.service';
import { localResumeStore } from '../store/local-resume.store';
import { useResumeEditorStore } from '../store/resume-editor.store';
import { useResumePdfPreview } from './useResumePdfPreview';

function editorError(error: unknown) {
  if (error instanceof UnsupportedResumeContentError) return error.message;
  if (error instanceof LocalResumeConflictError) return error.message;
  if (error instanceof ApiError) {
    if (error.code === 103001) return '这份简历不存在或已被删除';
    if (error.code === 103004) return '简历内容格式不正确';
    return error.message || '操作失败，请稍后重试';
  }
  if (error instanceof Error && error.message) return error.message;
  return '网络开小差了，请稍后重试';
}

type ImageAssetState = {
  blob: Blob | null;
  url: string | null;
};

export function useResumeEditor(resumeId: string, mode: ResumeEditorMode = 'cloud') {
  const document = useResumeEditorStore((state) => state.document);
  const changeVersion = useResumeEditorStore((state) => state.changeVersion);
  const saveStatus = useResumeEditorStore((state) => state.saveStatus);
  const durability = useResumeEditorStore((state) => state.durability);
  const persistence = useMemo(() => createResumePersistence(mode, resumeId), [mode, resumeId]);
  const [avatar, setAvatar] = useState<ImageAssetState>({ blob: null, url: null });
  const [schoolLogo, setSchoolLogo] = useState<ImageAssetState>({ blob: null, url: null });
  const [avatarRevision, setAvatarRevision] = useState(0);
  const [schoolLogoRevision, setSchoolLogoRevision] = useState(0);
  const avatarRef = useRef(avatar);
  const schoolLogoRef = useRef(schoolLogo);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const pendingDocumentSaveRef = useRef(false);
  const pendingAvatarRef = useRef<{ active: boolean; blob: Blob | null }>({
    active: false,
    blob: null,
  });
  const pendingSchoolLogoRef = useRef<{ active: boolean; blob: Blob | null }>({
    active: false,
    blob: null,
  });

  const replaceAvatar = useCallback((blob: Blob | null) => {
    const previous = avatarRef.current.url;
    if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
    const next = {
      blob,
      url: blob && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null,
    };
    avatarRef.current = next;
    setAvatar(next);
    setAvatarRevision((revision) => revision + 1);
  }, []);

  const replaceSchoolLogo = useCallback((blob: Blob | null) => {
    const previous = schoolLogoRef.current.url;
    if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
    const next = {
      blob,
      url: blob && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null,
    };
    schoolLogoRef.current = next;
    setSchoolLogo(next);
    setSchoolLogoRevision((revision) => revision + 1);
  }, []);

  const applySnapshot = useCallback(
    (snapshot: ResumeEditorSnapshot, replaceDocument = false) => {
      const store = useResumeEditorStore.getState();
      store.setDurability(snapshot.durability);
      if (replaceDocument) store.replaceDocument(snapshot.document);
      else store.load(snapshot.document);
      replaceAvatar(snapshot.avatar);
      replaceSchoolLogo(snapshot.schoolLogo);
    },
    [replaceAvatar, replaceSchoolLogo],
  );

  const load = useCallback(async () => {
    useResumeEditorStore.getState().setLoading();
    try {
      applySnapshot(await persistence.load());
    } catch (error) {
      useResumeEditorStore.getState().loadFailed(editorError(error));
    }
  }, [applySnapshot, persistence]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(loadTimer);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const avatarUrl = avatarRef.current.url;
      if (avatarUrl?.startsWith('blob:')) URL.revokeObjectURL(avatarUrl);
      const schoolLogoUrl = schoolLogoRef.current.url;
      if (schoolLogoUrl?.startsWith('blob:')) URL.revokeObjectURL(schoolLogoUrl);
      useResumeEditorStore.getState().reset();
    };
  }, [load]);

  // The callback schedules itself to serialize queued saves; React Compiler cannot safely rewrite that identity.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const flushSave = useCallback(async () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const state = useResumeEditorStore.getState();
    if (!state.document || !['dirty', 'failed'].includes(state.saveStatus)) {
      return;
    }
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    const snapshot = structuredClone(state.document);
    const snapshotVersion = state.changeVersion;
    state.setSaving();
    try {
      const saved = await persistence.save(snapshot, snapshot.revision);
      pendingDocumentSaveRef.current = false;
      const latest = useResumeEditorStore.getState();
      latest.setDurability(saved.durability);
      latest.applySaved(saved.document, snapshotVersion);
    } catch (error) {
      if (
        error instanceof LocalResumeConflictError ||
        (error instanceof ApiError && error.status === 409)
      ) {
        useResumeEditorStore.getState().setConflict();
      } else {
        if (error instanceof LocalResumeStorageError) {
          pendingDocumentSaveRef.current = true;
          useResumeEditorStore.getState().setDurability('read-only');
        }
        useResumeEditorStore.getState().setSaveFailed(editorError(error));
      }
    } finally {
      savingRef.current = false;
      if (pendingRef.current || useResumeEditorStore.getState().saveStatus === 'dirty') {
        pendingRef.current = false;
        window.setTimeout(() => void flushSave(), 0);
      }
    }
  }, [persistence]);

  useEffect(() => {
    if (!document || saveStatus !== 'dirty') return;
    timerRef.current = window.setTimeout(() => void flushSave(), 1000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [changeVersion, document, flushSave, saveStatus]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const state = useResumeEditorStore.getState();
      const hasUnsavedWork = ['dirty', 'saving', 'failed'].includes(state.saveStatus);
      if (!hasUnsavedWork && state.durability !== 'read-only') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const edit = useCallback(
    (updater: (document: ResumeDocument) => ResumeDocument, immediate = false) => {
      if (useResumeEditorStore.getState().durability === 'read-only') return;
      useResumeEditorStore.getState().updateDraft(updater);
      if (immediate) window.setTimeout(() => void flushSave(), 0);
    },
    [flushSave],
  );

  const reload = useCallback(() => {
    if (mode === 'local' && localResumeStore.getSnapshot().availability === 'read-only') {
      void localResumeStore
        .retry()
        .then(load)
        .catch((error) => {
          useResumeEditorStore.getState().setDurability('read-only');
          useResumeEditorStore.getState().setSaveFailed(editorError(error));
        });
      return;
    }
    void load();
  }, [load, mode]);

  const overwrite = useCallback(async () => {
    const local = useResumeEditorStore.getState().document;
    if (!local) return;
    try {
      const saved = await persistence.overwrite(local);
      useResumeEditorStore.getState().replaceDocument(saved.document);
      useResumeEditorStore.getState().setDurability(saved.durability);
      replaceAvatar(saved.avatar);
      replaceSchoolLogo(saved.schoolLogo);
    } catch (error) {
      if (error instanceof LocalResumeStorageError) {
        useResumeEditorStore.getState().setDurability('read-only');
      }
      useResumeEditorStore.getState().setSaveFailed(editorError(error));
    }
  }, [persistence, replaceAvatar, replaceSchoolLogo]);

  const replaceImport = useCallback(
    async (envelope: ResumeImportEnvelope) => {
      const current = useResumeEditorStore.getState().document;
      if (!current) return;
      try {
        const imported = await persistence.replaceImport(envelope, current);
        useResumeEditorStore.getState().replaceDocument(imported.document);
        useResumeEditorStore.getState().setDurability(imported.durability);
        replaceAvatar(imported.avatar);
        replaceSchoolLogo(imported.schoolLogo);
      } catch (error) {
        if (error instanceof LocalResumeStorageError) {
          useResumeEditorStore.getState().setDurability('read-only');
          useResumeEditorStore.getState().setSaveFailed(editorError(error));
        }
        throw error;
      }
    },
    [persistence, replaceAvatar, replaceSchoolLogo],
  );

  const saveAvatar = useCallback(
    async (blob: Blob) => {
      await flushSave();
      const current = useResumeEditorStore.getState().document;
      if (!current) return;
      try {
        const saved = await persistence.putAvatar(current, blob);
        pendingAvatarRef.current = { active: false, blob: null };
        useResumeEditorStore.getState().mergeServerMetadata(saved.document);
        useResumeEditorStore.getState().setDurability(saved.durability);
        replaceAvatar(saved.avatar);
      } catch (error) {
        if (error instanceof LocalResumeStorageError) {
          pendingAvatarRef.current = { active: true, blob };
          useResumeEditorStore.getState().setDurability('read-only');
          useResumeEditorStore.getState().setSaveFailed(editorError(error));
          replaceAvatar(blob);
        }
        throw error;
      }
    },
    [flushSave, persistence, replaceAvatar],
  );

  const deleteAvatar = useCallback(async () => {
    await flushSave();
    const current = useResumeEditorStore.getState().document;
    if (!current) return;
    try {
      const saved = await persistence.deleteAvatar(current);
      pendingAvatarRef.current = { active: false, blob: null };
      useResumeEditorStore.getState().mergeServerMetadata(saved.document);
      useResumeEditorStore.getState().setDurability(saved.durability);
      replaceAvatar(saved.avatar);
    } catch (error) {
      if (error instanceof LocalResumeStorageError) {
        pendingAvatarRef.current = { active: true, blob: null };
        useResumeEditorStore.getState().setDurability('read-only');
        useResumeEditorStore.getState().setSaveFailed(editorError(error));
        replaceAvatar(null);
      }
      throw error;
    }
  }, [flushSave, persistence, replaceAvatar]);

  const saveSchoolLogo = useCallback(
    async (blob: Blob) => {
      await flushSave();
      const current = useResumeEditorStore.getState().document;
      if (!current) return;
      try {
        const saved = await persistence.putSchoolLogo(current, blob);
        pendingSchoolLogoRef.current = { active: false, blob: null };
        useResumeEditorStore.getState().mergeServerMetadata(saved.document);
        useResumeEditorStore.getState().setDurability(saved.durability);
        replaceSchoolLogo(saved.schoolLogo);
      } catch (error) {
        if (error instanceof LocalResumeStorageError) {
          pendingSchoolLogoRef.current = { active: true, blob };
          useResumeEditorStore.getState().setDurability('read-only');
          useResumeEditorStore.getState().setSaveFailed(editorError(error));
          replaceSchoolLogo(blob);
        }
        throw error;
      }
    },
    [flushSave, persistence, replaceSchoolLogo],
  );

  const deleteSchoolLogo = useCallback(async () => {
    await flushSave();
    const current = useResumeEditorStore.getState().document;
    if (!current) return;
    try {
      const saved = await persistence.deleteSchoolLogo(current);
      pendingSchoolLogoRef.current = { active: false, blob: null };
      useResumeEditorStore.getState().mergeServerMetadata(saved.document);
      useResumeEditorStore.getState().setDurability(saved.durability);
      replaceSchoolLogo(saved.schoolLogo);
    } catch (error) {
      if (error instanceof LocalResumeStorageError) {
        pendingSchoolLogoRef.current = { active: true, blob: null };
        useResumeEditorStore.getState().setDurability('read-only');
        useResumeEditorStore.getState().setSaveFailed(editorError(error));
        replaceSchoolLogo(null);
      }
      throw error;
    }
  }, [flushSave, persistence, replaceSchoolLogo]);

  const pdfPreview = useResumePdfPreview({
    active: mode === 'local',
    avatar: avatar.url,
    avatarRevision,
    schoolLogo: schoolLogo.url,
    schoolLogoRevision,
    document,
    documentVersion: changeVersion,
  });

  const exportPdf = useCallback(async () => {
    const current = useResumeEditorStore.getState().document;
    if (!current) throw new Error('简历尚未加载');
    if (mode === 'local') {
      const blob = await pdfPreview.getLatestBlob();
      if (persistence.recordExport && durability !== 'read-only') {
        try {
          useResumeEditorStore.getState().mergeServerMetadata(await persistence.recordExport());
        } catch (error) {
          if (error instanceof LocalResumeStorageError) {
            useResumeEditorStore.getState().setDurability('read-only');
            useResumeEditorStore.getState().setSaveFailed(editorError(error));
          } else {
            throw error;
          }
        }
      }
      return blob;
    }
    await flushSave();
    if (!persistence.exportPdf) throw new Error('PDF 导出不可用');
    const blob = await persistence.exportPdf(current);
    if (persistence.refreshMetadata) {
      useResumeEditorStore.getState().mergeServerMetadata(await persistence.refreshMetadata());
    }
    return blob;
  }, [durability, flushSave, mode, pdfPreview, persistence]);

  const getAvatarDataUrl = useCallback(async () => {
    if (!avatarRef.current.blob) return null;
    return blobToDataUrl(avatarRef.current.blob);
  }, []);

  const getSchoolLogoDataUrl = useCallback(async () => {
    if (!schoolLogoRef.current.blob) return null;
    return blobToDataUrl(schoolLogoRef.current.blob);
  }, []);

  const retryStorage = useCallback(async () => {
    const current = useResumeEditorStore.getState().document;
    try {
      if (!current) {
        await load();
        return;
      }
      if (pendingAvatarRef.current.active) {
        const pendingAvatar = pendingAvatarRef.current.blob;
        const saved = pendingAvatar
          ? await persistence.putAvatar(current, pendingAvatar)
          : await persistence.deleteAvatar(current);
        pendingAvatarRef.current = { active: false, blob: null };
        useResumeEditorStore.getState().mergeServerMetadata(saved.document);
        useResumeEditorStore.getState().setDurability(saved.durability);
        replaceAvatar(saved.avatar);
        replaceSchoolLogo(saved.schoolLogo);
        return;
      }
      if (pendingSchoolLogoRef.current.active) {
        const pendingSchoolLogo = pendingSchoolLogoRef.current.blob;
        const saved = pendingSchoolLogo
          ? await persistence.putSchoolLogo(current, pendingSchoolLogo)
          : await persistence.deleteSchoolLogo(current);
        pendingSchoolLogoRef.current = { active: false, blob: null };
        useResumeEditorStore.getState().mergeServerMetadata(saved.document);
        useResumeEditorStore.getState().setDurability(saved.durability);
        replaceSchoolLogo(saved.schoolLogo);
        return;
      }
      if (pendingDocumentSaveRef.current) {
        await flushSave();
        return;
      }
      if (mode === 'local') {
        const reconnected = await localResumeStore.reconnect(resumeId, current.revision);
        applySnapshot({ ...reconnected, durability: 'persistent' }, true);
        return;
      }
      await load();
    } catch (error) {
      if (error instanceof LocalResumeConflictError) {
        useResumeEditorStore.getState().setConflict();
      } else {
        if (error instanceof LocalResumeStorageError) {
          useResumeEditorStore.getState().setDurability('read-only');
        }
        useResumeEditorStore.getState().setSaveFailed(editorError(error));
      }
    }
  }, [
    applySnapshot,
    flushSave,
    load,
    mode,
    persistence,
    replaceAvatar,
    replaceSchoolLogo,
    resumeId,
  ]);

  return {
    avatarBlob: avatar.blob,
    avatarUrl: avatar.url,
    deleteAvatar,
    deleteSchoolLogo,
    durability,
    edit,
    exportPdf,
    flushSave,
    getAvatarDataUrl,
    getSchoolLogoDataUrl,
    load,
    mode,
    overwrite,
    pdfPreview,
    reload,
    replaceImport,
    retryStorage,
    saveAvatar,
    saveSchoolLogo,
    schoolLogoBlob: schoolLogo.blob,
    schoolLogoUrl: schoolLogo.url,
  };
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('无法读取头像'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}
