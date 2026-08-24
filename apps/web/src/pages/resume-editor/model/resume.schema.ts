import { z } from 'zod';

const id = z.string().min(1);
const text = z.string().max(10_000);
const politicalStatus = z.string().max(320);
const month = z.string().regex(/^$|^\d{4}-(0[1-9]|1[0-2])$/);
const integerBetween = (minimum: number, maximum: number) =>
  z.number().int().min(minimum).max(maximum);
const spacingBeforePx = integerBetween(0, 64).optional();
const baseSectionV2 = { id, title: z.string().trim().min(1).max(40), enabled: z.boolean() };
const baseSectionV3 = { ...baseSectionV2, spacingBeforePx };
const baseItemV2 = { id };
const baseItemV3 = { id, spacingBeforePx };

function createItemSchemas(baseItem: typeof baseItemV2 | typeof baseItemV3) {
  return {
    work: z
      .object({
        ...baseItem,
        company: text,
        role: text,
        location: text,
        startDate: month,
        endDate: month,
        isCurrent: z.boolean(),
        description: text,
      })
      .strict(),
    education: z
      .object({
        ...baseItem,
        school: text,
        major: text,
        degree: text,
        startDate: month,
        endDate: month,
        description: text,
      })
      .strict(),
    project: z
      .object({
        ...baseItem,
        name: text,
        role: text,
        startDate: month,
        endDate: month,
        isCurrent: z.boolean(),
        description: text,
      })
      .strict(),
    awards: z
      .object({ ...baseItem, title: text, issuer: text, date: month, description: text })
      .strict(),
    custom: z
      .object({
        ...baseItem,
        title: text,
        subtitle: text,
        location: text,
        startDate: month,
        endDate: month,
        isCurrent: z.boolean(),
        description: text,
      })
      .strict(),
  };
}

function createSectionSchema(
  baseSection: typeof baseSectionV2 | typeof baseSectionV3,
  baseItem: typeof baseItemV2 | typeof baseItemV3,
) {
  const items = createItemSchemas(baseItem);
  return z.discriminatedUnion('type', [
    z
      .object({
        ...baseSection,
        id: z.literal('summary'),
        type: z.literal('summary'),
        text,
      })
      .strict(),
    z
      .object({
        ...baseSection,
        id: z.literal('work'),
        type: z.literal('work'),
        items: z.array(items.work).max(100),
      })
      .strict(),
    z
      .object({
        ...baseSection,
        id: z.literal('education'),
        type: z.literal('education'),
        items: z.array(items.education).max(100),
      })
      .strict(),
    z
      .object({
        ...baseSection,
        id: z.literal('project'),
        type: z.literal('project'),
        items: z.array(items.project).max(100),
      })
      .strict(),
    z
      .object({
        ...baseSection,
        id: z.literal('skills'),
        type: z.literal('skills'),
        description: text,
      })
      .strict(),
    z
      .object({
        ...baseSection,
        id: z.literal('awards'),
        type: z.literal('awards'),
        items: z.array(items.awards).max(100),
      })
      .strict(),
    z
      .object({
        ...baseSection,
        type: z.literal('custom'),
        items: z.array(items.custom).max(100),
      })
      .strict(),
  ]);
}

const profileV3Schema = z
  .object({
    fullName: text,
    targetRole: text,
    phone: text,
    email: text,
    location: text,
    links: z.array(z.object({ id, label: text, url: text }).strict()).max(20),
  })
  .strict();

const profileSchema = profileV3Schema
  .extend({ enabled: z.boolean(), politicalStatus: politicalStatus.default('') })
  .strict();

const pageMarginSchema = z
  .object({
    top: integerBetween(0, 160),
    right: integerBetween(0, 160),
    bottom: integerBetween(0, 160),
    left: integerBetween(0, 160),
  })
  .strict();

const accentColorSchema = z.union([
  z.enum(['plum', 'navy', 'teal', 'rust', 'charcoal', 'black']),
  z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .transform((value) => value as `#${string}`),
]);

const baseFormatting = {
  nameFontSizePx: integerBetween(12, 48),
  sectionTitleFontSizePx: integerBetween(10, 32),
  entryTitleFontSizePx: integerBetween(8, 28),
  bodyFontSizePx: integerBetween(8, 24),
  lineHeightRatio: z.number().min(1).max(2.5),
  pageMarginPx: pageMarginSchema,
  sectionGapPx: integerBetween(0, 64),
  fontFamily: z.enum(['source-han-sans', 'source-han-serif']),
  accentColor: accentColorSchema,
};

function createContentSchema(
  profile: z.ZodType,
  sections: ReturnType<typeof createSectionSchema>,
  formatting: z.ZodType,
) {
  return z
    .object({
      profile,
      sections: z.array(sections).max(64),
      formatting,
    })
    .strict()
    .superRefine((content, context) => {
      const ids = new Set<string>();
      const builtinTypes = new Set<string>();
      for (const section of content.sections) {
        if (ids.has(section.id)) context.addIssue({ code: 'custom', message: '板块 ID 重复' });
        ids.add(section.id);
        if (section.type !== 'custom') {
          if (builtinTypes.has(section.type))
            context.addIssue({ code: 'custom', message: '内置板块重复' });
          builtinTypes.add(section.type);
        }
      }
    });
}

export const resumeContentV2Schema = createContentSchema(
  profileV3Schema,
  createSectionSchema(baseSectionV2, baseItemV2),
  z.object(baseFormatting).strict(),
);

export const resumeContentV3Schema = createContentSchema(
  profileV3Schema,
  createSectionSchema(baseSectionV3, baseItemV3),
  z.object({ ...baseFormatting, entryGapPx: integerBetween(0, 64) }).strict(),
);

export const resumeContentSchema = createContentSchema(
  profileSchema,
  createSectionSchema(baseSectionV3, baseItemV3),
  z.object({ ...baseFormatting, entryGapPx: integerBetween(0, 64) }).strict(),
);

const avatar = z.string().startsWith('data:image/jpeg;base64,').max(750_000).nullish();
const schoolLogo = z.string().startsWith('data:image/png;base64,').max(750_000).nullish();

export const importEnvelopeSchema = z.union([
  z
    .object({
      version: z.literal(2),
      title: z.string().trim().min(1).max(80),
      templateId: z.enum(['modern-editorial', 'classic-professional']).nullish(),
      avatar,
      content: resumeContentV2Schema,
    })
    .strict(),
  z
    .object({
      version: z.literal(3),
      title: z.string().trim().min(1).max(80),
      profileAlignment: z.enum(['left', 'center', 'right']),
      avatar,
      content: resumeContentV3Schema,
    })
    .strict(),
  z
    .object({
      version: z.literal(4),
      title: z.string().trim().min(1).max(80),
      profileAlignment: z.enum(['left', 'center', 'right']),
      avatar,
      schoolLogo,
      content: resumeContentSchema,
    })
    .strict(),
]);
