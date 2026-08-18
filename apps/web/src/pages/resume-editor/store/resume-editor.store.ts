import { create } from 'zustand';

import type { PersistenceDurability } from '../model/resume.editor';
import type { ResumeDocument, SaveStatus } from '../model/resume.types';

type EditorState = {
  document: ResumeDocument | null;
  error: string | null;
  isLoading: boolean;
  saveStatus: SaveStatus;
  durability: PersistenceDurability;
  changeVersion: number;
  load: (document: ResumeDocument) => void;
  loadFailed: (message: string) => void;
  setLoading: () => void;
  updateDraft: (updater: (document: ResumeDocument) => ResumeDocument) => void;
  setSaving: () => void;
  applySaved: (document: ResumeDocument, savedVersion: number) => void;
  mergeServerMetadata: (document: ResumeDocument) => void;
  setSaveFailed: (message: string) => void;
  setConflict: () => void;
  replaceDocument: (document: ResumeDocument) => void;
  setDurability: (durability: PersistenceDurability) => void;
  reset: () => void;
};

const initialState = {
  document: null,
  error: null,
  isLoading: true,
  saveStatus: 'idle' as SaveStatus,
  durability: 'persistent' as PersistenceDurability,
  changeVersion: 0,
};

export const useResumeEditorStore = create<EditorState>()((set, get) => ({
  ...initialState,
  load: (document) =>
    set({ document, error: null, isLoading: false, saveStatus: 'saved', changeVersion: 0 }),
  loadFailed: (message) => set({ error: message, isLoading: false }),
  setLoading: () => set({ error: null, isLoading: true }),
  updateDraft: (updater) => {
    const current = get().document;
    if (!current) return;
    set((state) => ({
      document: updater(current),
      changeVersion: state.changeVersion + 1,
      saveStatus: 'dirty',
      error: null,
    }));
  },
  setSaving: () => set({ saveStatus: 'saving', error: null }),
  applySaved: (document, savedVersion) =>
    set((state) => ({
      document: state.document
        ? {
            ...state.document,
            revision: document.revision,
            exportCount: document.exportCount,
            updatedAt: document.updatedAt,
            hasAvatar: document.hasAvatar,
            hasSchoolLogo: document.hasSchoolLogo,
          }
        : document,
      saveStatus: state.changeVersion === savedVersion ? 'saved' : 'dirty',
      error: null,
    })),
  mergeServerMetadata: (document) =>
    set((state) => ({
      document: state.document
        ? {
            ...state.document,
            exportCount: document.exportCount,
            hasAvatar: document.hasAvatar,
            hasSchoolLogo: document.hasSchoolLogo,
            revision: document.revision,
            updatedAt: document.updatedAt,
          }
        : document,
    })),
  setSaveFailed: (message) => set({ error: message, saveStatus: 'failed' }),
  setConflict: () =>
    set({ saveStatus: 'conflict', error: '这份简历已在其他页面更新，请选择保留哪个版本。' }),
  replaceDocument: (document) =>
    set({ document, error: null, isLoading: false, saveStatus: 'saved', changeVersion: 0 }),
  setDurability: (durability) => set({ durability }),
  reset: () => set(initialState),
}));
