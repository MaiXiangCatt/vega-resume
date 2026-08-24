import type { ResumeContent } from '@/shared/api/generated/model/resumeContent';

import { resumeHasPrintableContent } from './resume.preview';
import {
  importEnvelopeSchema,
  resumeContentSchema,
  resumeContentV2Schema,
  resumeContentV3Schema,
} from './resume.schema';
import type {
  AccentColor,
  CustomItem,
  LegacyTemplateId,
  PresetAccentColor,
  ProfileAlignment,
  ResumeContentV4,
  ResumeFontFamily,
  ResumeFormatting,
  ResumeImportEnvelope,
  ResumeSection,
  SectionType,
} from './resume.types';

export const BUILTIN_TITLES: Record<Exclude<SectionType, 'custom'>, string> = {
  summary: '个人简介',
  work: '工作经历',
  education: '教育背景',
  project: '项目经历',
  skills: '技能',
  awards: '奖项荣誉',
};

export const ACCENT_COLORS: Record<PresetAccentColor, string> = {
  plum: '#850477',
  navy: '#1f3a5f',
  teal: '#147d73',
  rust: '#a3482b',
  charcoal: '#374151',
  black: '#000000',
};

export const RESUME_FONT_FAMILIES: Record<
  ResumeFontFamily,
  { cssFamily: string; label: string; pdfFamily: string }
> = {
  'source-han-sans': {
    cssFamily: "'Noto Sans SC', 'PingFang SC', sans-serif",
    label: '思源黑体',
    pdfFamily: 'NotoSansSC',
  },
  'source-han-serif': {
    cssFamily: "'Noto Serif SC', 'Songti SC', serif",
    label: '思源宋体',
    pdfFamily: 'NotoSerifSC',
  },
};

export function resolveAccentColor(value: AccentColor): string {
  return value.startsWith('#') ? value : ACCENT_COLORS[value as PresetAccentColor];
}

export function createDefaultFormatting(): ResumeFormatting {
  return {
    nameFontSizePx: 20,
    sectionTitleFontSizePx: 16,
    entryTitleFontSizePx: 14,
    bodyFontSizePx: 14,
    lineHeightRatio: 1.5,
    pageMarginPx: { top: 33, right: 33, bottom: 33, left: 33 },
    sectionGapPx: 8,
    entryGapPx: 14,
    fontFamily: 'source-han-sans',
    accentColor: 'plum',
  };
}

export function createDefaultContent(): ResumeContentV4 {
  return {
    profile: {
      enabled: true,
      fullName: '',
      targetRole: '',
      phone: '',
      email: '',
      location: '',
      politicalStatus: '',
      links: [],
    },
    sections: [
      { id: 'summary', type: 'summary', title: '个人简介', enabled: true, text: '' },
      { id: 'work', type: 'work', title: '工作经历', enabled: true, items: [] },
      { id: 'education', type: 'education', title: '教育背景', enabled: true, items: [] },
      { id: 'project', type: 'project', title: '项目经历', enabled: true, items: [] },
      { id: 'skills', type: 'skills', title: '技能', enabled: true, description: '' },
      { id: 'awards', type: 'awards', title: '奖项荣誉', enabled: false, items: [] },
    ],
    formatting: createDefaultFormatting(),
  };
}

export function parseResumeContent(
  value: ResumeContent | unknown,
  version: 2 | 3 | 4 = 4,
): ResumeContentV4 {
  if (version === 4) return resumeContentSchema.parse(value) as ResumeContentV4;
  if (version === 3) {
    const content = resumeContentV3Schema.parse(value) as {
      profile: Omit<ResumeContentV4['profile'], 'enabled' | 'politicalStatus'>;
      sections: ResumeContentV4['sections'];
      formatting: ResumeFormatting;
    };
    return resumeContentSchema.parse({
      ...content,
      profile: { ...content.profile, enabled: true, politicalStatus: '' },
    }) as ResumeContentV4;
  }
  const content = resumeContentV2Schema.parse(value) as {
    profile: Omit<ResumeContentV4['profile'], 'enabled' | 'politicalStatus'>;
    sections: ResumeContentV4['sections'];
    formatting: Omit<ResumeFormatting, 'entryGapPx'>;
  };
  return resumeContentSchema.parse({
    ...content,
    profile: { ...content.profile, enabled: true, politicalStatus: '' },
    formatting: {
      ...content.formatting,
      entryGapPx: content.formatting.bodyFontSizePx,
    },
  }) as ResumeContentV4;
}

export function parseImportEnvelope(value: unknown): ResumeImportEnvelope {
  const envelope = importEnvelopeSchema.parse(value);
  if (envelope.version === 4) return envelope as ResumeImportEnvelope;
  return {
    version: 4,
    title: envelope.title,
    profileAlignment:
      envelope.version === 2
        ? normalizeProfileAlignment(envelope.templateId)
        : envelope.profileAlignment,
    content: parseResumeContent(envelope.content, envelope.version),
    avatar: envelope.avatar,
    schoolLogo: null,
  };
}

export function normalizeProfileAlignment(
  value: ProfileAlignment | LegacyTemplateId | null | undefined | unknown,
): ProfileAlignment {
  if (value === 'classic-professional') return 'center';
  if (value === 'modern-editorial' || value == null) return 'left';
  if (value === 'left' || value === 'center' || value === 'right') return value;
  throw new Error('Unsupported profile alignment');
}

export function legacyTemplateIdForAlignment(alignment: ProfileAlignment): LegacyTemplateId | null {
  if (alignment === 'left') return 'modern-editorial';
  if (alignment === 'center') return 'classic-professional';
  return null;
}

export function createCustomSection(title: string): ResumeSection {
  return {
    id: crypto.randomUUID(),
    type: 'custom',
    title: title.trim(),
    enabled: true,
    items: [createSectionItem('custom') as CustomItem],
  };
}

export function createSectionItem(type: Exclude<SectionType, 'summary' | 'skills'>) {
  const id = crypto.randomUUID();
  switch (type) {
    case 'work':
      return {
        id,
        company: '',
        role: '',
        location: '',
        startDate: '',
        endDate: '',
        isCurrent: false,
        description: '',
      };
    case 'education':
      return { id, school: '', major: '', degree: '', startDate: '', endDate: '', description: '' };
    case 'project':
      return {
        id,
        name: '',
        role: '',
        startDate: '',
        endDate: '',
        isCurrent: false,
        description: '',
      };
    case 'awards':
      return { id, title: '', issuer: '', date: '', description: '' };
    case 'custom':
      return {
        id,
        title: '',
        subtitle: '',
        location: '',
        startDate: '',
        endDate: '',
        isCurrent: false,
        description: '',
      };
  }
}

export function moveById<T extends { id: string }>(items: T[], activeId: string, overId: string) {
  const from = items.findIndex((item) => item.id === activeId);
  const to = items.findIndex((item) => item.id === overId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function completionIssues(
  content: ResumeContentV4,
  hasAvatar = false,
  hasSchoolLogo = false,
) {
  const issues: string[] = [];
  if (content.profile.enabled && !content.profile.fullName.trim()) issues.push('请填写姓名');
  if (!resumeHasPrintableContent(content, hasAvatar, hasSchoolLogo))
    issues.push('请至少显示一项有内容的模块');
  return issues;
}
