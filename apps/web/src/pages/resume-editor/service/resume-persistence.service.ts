import type {
  ResumeEditorMode,
  ResumeEditorPersistence,
  ResumeEditorSnapshot,
} from '../model/resume.editor';
import type { ResumeDocument } from '../model/resume.types';
import { resumeEditorService } from './resume-editor.service';
import { localResumeStore } from '../store/local-resume.store';

export function createResumePersistence(
  mode: ResumeEditorMode,
  resumeId: string,
): ResumeEditorPersistence {
  if (mode === 'local') {
    const snapshot = async (
      operation: Promise<{
        avatar: Blob | null;
        schoolLogo: Blob | null;
        document: ResumeDocument;
      }>,
    ): Promise<ResumeEditorSnapshot> => {
      const result = await operation;
      return {
        ...result,
        durability:
          localResumeStore.getSnapshot().availability === 'read-only' ? 'read-only' : 'persistent',
      };
    };
    return {
      deleteAvatar: async (document) =>
        snapshot(
          localResumeStore
            .deleteAvatar(document)
            .then((saved) => localResumeStore.cachedSnapshot(saved.id)),
        ),
      deleteSchoolLogo: async (document) =>
        snapshot(
          localResumeStore
            .deleteSchoolLogo(document)
            .then((saved) => localResumeStore.cachedSnapshot(saved.id)),
        ),
      load: () => snapshot(localResumeStore.get(resumeId)),
      overwrite: async (document) =>
        snapshot(
          localResumeStore
            .overwrite(document)
            .then((saved) => localResumeStore.cachedSnapshot(saved.id)),
        ),
      putAvatar: async (document, avatar) =>
        snapshot(
          localResumeStore
            .putAvatar(document, avatar)
            .then((saved) => localResumeStore.cachedSnapshot(saved.id)),
        ),
      putSchoolLogo: async (document, schoolLogo) =>
        snapshot(
          localResumeStore
            .putSchoolLogo(document, schoolLogo)
            .then((saved) => localResumeStore.cachedSnapshot(saved.id)),
        ),
      recordExport: () => localResumeStore.recordExport(resumeId),
      replaceImport: async (envelope, document) =>
        snapshot(
          localResumeStore
            .replaceImport(resumeId, document.revision, envelope)
            .then((saved) => localResumeStore.cachedSnapshot(saved.id)),
        ),
      save: async (document, expectedRevision) =>
        snapshot(
          localResumeStore
            .save(document, expectedRevision)
            .then((saved) => localResumeStore.cachedSnapshot(saved.id)),
        ),
    };
  }

  let avatar: Blob | null = null;
  let schoolLogo: Blob | null = null;
  const snapshot = (
    document: ResumeDocument,
    nextAvatar = avatar,
    nextSchoolLogo = schoolLogo,
  ): ResumeEditorSnapshot => ({
    document,
    avatar: nextAvatar,
    schoolLogo: nextSchoolLogo,
    durability: 'persistent',
  });

  return {
    async load() {
      const document = await resumeEditorService.get(resumeId);
      avatar = document.hasAvatar ? await resumeEditorService.getAvatar(resumeId) : null;
      schoolLogo = document.hasSchoolLogo
        ? await resumeEditorService.getSchoolLogo(resumeId)
        : null;
      return snapshot(document);
    },
    async save(document, expectedRevision) {
      return snapshot(await resumeEditorService.update(document, expectedRevision));
    },
    async overwrite(document) {
      const server = await resumeEditorService.get(resumeId);
      return snapshot(await resumeEditorService.update(document, server.revision));
    },
    async replaceImport(envelope, document) {
      const imported = await resumeEditorService.replaceImport(
        resumeId,
        document.revision,
        envelope,
      );
      avatar = envelope.avatar ? dataUrlToBlob(envelope.avatar) : null;
      schoolLogo = envelope.schoolLogo ? dataUrlToBlob(envelope.schoolLogo) : null;
      return snapshot(imported);
    },
    async putAvatar(_document, nextAvatar) {
      const updated = await resumeEditorService.putAvatar(resumeId, nextAvatar);
      avatar = nextAvatar;
      return snapshot(updated);
    },
    async deleteAvatar() {
      const updated = await resumeEditorService.deleteAvatar(resumeId);
      avatar = null;
      return snapshot(updated);
    },
    async putSchoolLogo(_document, nextSchoolLogo) {
      const updated = await resumeEditorService.putSchoolLogo(resumeId, nextSchoolLogo);
      schoolLogo = nextSchoolLogo;
      return snapshot(updated);
    },
    async deleteSchoolLogo() {
      const updated = await resumeEditorService.deleteSchoolLogo(resumeId);
      schoolLogo = null;
      return snapshot(updated);
    },
    exportPdf: () => resumeEditorService.exportPdf(resumeId),
    refreshMetadata: () => resumeEditorService.get(resumeId),
  };
}

function dataUrlToBlob(value: string) {
  const [header, encoded = ''] = value.split(',', 2);
  const mime = /^data:([^;]+);base64$/.exec(header)?.[1] ?? 'application/octet-stream';
  const binary = atob(encoded);
  return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], {
    type: mime,
  });
}
