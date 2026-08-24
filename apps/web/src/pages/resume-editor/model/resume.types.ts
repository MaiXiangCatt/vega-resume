export type ProfileAlignment = 'left' | 'center' | 'right';
export type LegacyTemplateId = 'modern-editorial' | 'classic-professional';
export type ResumeStatus = 'draft' | 'completed';
export type SectionType =
  'summary' | 'work' | 'education' | 'project' | 'skills' | 'awards' | 'custom';
export type ResumeFontFamily = 'source-han-sans' | 'source-han-serif';
export type PresetAccentColor = 'plum' | 'navy' | 'teal' | 'rust' | 'charcoal' | 'black';
export type AccentColor = PresetAccentColor | `#${string}`;

export type ContactLink = { id: string; label: string; url: string };

export type ResumeProfile = {
  enabled: boolean;
  fullName: string;
  targetRole: string;
  phone: string;
  email: string;
  location: string;
  politicalStatus: string;
  links: ContactLink[];
};

export type BaseItem = { id: string; spacingBeforePx?: number };
export type WorkItem = BaseItem & {
  company: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
};
export type EducationItem = BaseItem & {
  school: string;
  major: string;
  degree: string;
  startDate: string;
  endDate: string;
  description: string;
};
export type ProjectItem = BaseItem & {
  name: string;
  role: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
};
export type AwardItem = BaseItem & {
  title: string;
  issuer: string;
  date: string;
  description: string;
};
export type CustomItem = BaseItem & {
  title: string;
  subtitle: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
};

type SectionBase<T extends SectionType> = {
  id: string;
  type: T;
  title: string;
  enabled: boolean;
  spacingBeforePx?: number;
};
export type SummarySection = SectionBase<'summary'> & { text: string };
export type WorkSection = SectionBase<'work'> & { items: WorkItem[] };
export type EducationSection = SectionBase<'education'> & { items: EducationItem[] };
export type ProjectSection = SectionBase<'project'> & { items: ProjectItem[] };
export type SkillsSection = SectionBase<'skills'> & { description: string };
export type AwardsSection = SectionBase<'awards'> & { items: AwardItem[] };
export type CustomSection = SectionBase<'custom'> & { items: CustomItem[] };
export type ResumeSection =
  | SummarySection
  | WorkSection
  | EducationSection
  | ProjectSection
  | SkillsSection
  | AwardsSection
  | CustomSection;

export type ResumeFormatting = {
  nameFontSizePx: number;
  sectionTitleFontSizePx: number;
  entryTitleFontSizePx: number;
  bodyFontSizePx: number;
  lineHeightRatio: number;
  pageMarginPx: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  sectionGapPx: number;
  entryGapPx: number;
  fontFamily: ResumeFontFamily;
  accentColor: AccentColor;
};

export type ResumeContentV4 = {
  profile: ResumeProfile;
  sections: ResumeSection[];
  formatting: ResumeFormatting;
};

export type ResumeDocument = {
  id: string;
  title: string;
  status: ResumeStatus;
  revision: number;
  hasAvatar: boolean;
  hasSchoolLogo: boolean;
  profileAlignment: ProfileAlignment;
  exportCount: number;
  contentVersion: 4;
  content: ResumeContentV4;
  createdAt: string;
  updatedAt: string;
};

export type ResumeImportEnvelope = {
  version: 4;
  title: string;
  profileAlignment: ProfileAlignment;
  content: ResumeContentV4;
  avatar?: string | null;
  schoolLogo?: string | null;
};

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed' | 'conflict';
