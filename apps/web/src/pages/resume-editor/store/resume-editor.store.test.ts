import { beforeEach, describe, expect, it } from 'vitest';

import { createDefaultContent } from '../model/resume.model';
import type { ResumeDocument } from '../model/resume.types';
import { useResumeEditorStore } from './resume-editor.store';

const document: ResumeDocument = {
  id: 'resume-1',
  title: 'Resume',
  status: 'draft',
  revision: 1,
  hasAvatar: false,
  hasSchoolLogo: false,
  profileAlignment: 'left',
  exportCount: 0,
  contentVersion: 4,
  content: createDefaultContent(),
  createdAt: '2026-07-22T00:00:00Z',
  updatedAt: '2026-07-22T00:00:00Z',
};

describe('resume editor store', () => {
  beforeEach(() => useResumeEditorStore.getState().reset());

  it('keeps edits made during an in-flight save dirty', () => {
    const store = useResumeEditorStore.getState();
    store.load(structuredClone(document));
    store.updateDraft((current) => ({ ...current, title: 'first' }));
    const savedVersion = useResumeEditorStore.getState().changeVersion;
    store.setSaving();
    store.updateDraft((current) => ({ ...current, title: 'second' }));
    store.applySaved({ ...document, revision: 2 }, savedVersion);

    expect(useResumeEditorStore.getState().document?.title).toBe('second');
    expect(useResumeEditorStore.getState().document?.revision).toBe(2);
    expect(useResumeEditorStore.getState().saveStatus).toBe('dirty');
  });

  it('preserves the local draft while merging server metadata', () => {
    const store = useResumeEditorStore.getState();
    store.load(structuredClone(document));
    store.updateDraft((current) => ({ ...current, title: 'local' }));
    store.mergeServerMetadata({
      ...document,
      revision: 2,
      hasAvatar: true,
      hasSchoolLogo: true,
      exportCount: 1,
    });

    const state = useResumeEditorStore.getState();
    expect(state.document).toMatchObject({
      title: 'local',
      revision: 2,
      hasAvatar: true,
      hasSchoolLogo: true,
      exportCount: 1,
    });
    expect(state.saveStatus).toBe('dirty');
  });
});
