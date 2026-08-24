import { describe, expect, it } from 'vitest';

import {
  completionIssues,
  createCustomSection,
  createDefaultContent,
  moveById,
  parseImportEnvelope,
  parseResumeContent,
} from './resume.model';

describe('resume editor model', () => {
  it('creates the default built-in catalog with awards disabled', () => {
    const content = createDefaultContent();

    expect(content.sections.map(({ id, enabled }) => [id, enabled])).toEqual([
      ['summary', true],
      ['work', true],
      ['education', true],
      ['project', true],
      ['skills', true],
      ['awards', false],
    ]);
    expect(content.sections.find((section) => section.type === 'skills')).toMatchObject({
      description: '',
    });
    expect(content.profile.politicalStatus).toBe('');
    expect(content.formatting).toEqual({
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
    });
  });

  it('migrates v2 content and legacy templates into the v4 model', () => {
    const legacyContent = structuredClone(createDefaultContent()) as Record<string, unknown>;
    const profile = legacyContent.profile as Record<string, unknown>;
    delete profile.enabled;
    delete profile.politicalStatus;
    const formatting = legacyContent.formatting as Record<string, unknown>;
    delete formatting.entryGapPx;
    formatting.bodyFontSizePx = 16;

    const migrated = parseImportEnvelope({
      version: 2,
      title: 'Legacy resume',
      templateId: 'classic-professional',
      content: legacyContent,
    });

    expect(migrated).toMatchObject({
      version: 4,
      profileAlignment: 'center',
      content: {
        profile: {
          enabled: true,
          politicalStatus: '',
        },
        formatting: {
          bodyFontSizePx: 16,
          entryGapPx: 16,
        },
      },
    });
    expect(migrated).not.toHaveProperty('templateId');
  });

  it('accepts v4 spacing boundaries and rejects invalid overrides', () => {
    const content = createDefaultContent();
    const work = content.sections.find((section) => section.type === 'work');
    if (!work || work.type !== 'work') throw new Error('missing work section');
    work.spacingBeforePx = 0;
    work.items.push({
      id: crypto.randomUUID(),
      company: '',
      role: '',
      location: '',
      startDate: '',
      endDate: '',
      isCurrent: false,
      description: '',
      spacingBeforePx: 64,
    });

    expect(parseResumeContent(content, 4)).toEqual(content);

    work.items[0].spacingBeforePx = 1.5;
    expect(() => parseResumeContent(content, 4)).toThrow();
  });

  it('normalizes an omitted v4 political status and validates supplied values', () => {
    const legacyV4 = structuredClone(createDefaultContent()) as Record<string, unknown>;
    delete (legacyV4.profile as Record<string, unknown>).politicalStatus;

    expect(parseResumeContent(legacyV4, 4).profile.politicalStatus).toBe('');

    const content = createDefaultContent();
    content.profile.politicalStatus = '中共党员';
    expect(parseResumeContent(content, 4).profile.politicalStatus).toBe('中共党员');
    expect(() =>
      parseResumeContent({
        ...content,
        profile: { ...content.profile, politicalStatus: 1 },
      }),
    ).toThrow();
    expect(() =>
      parseResumeContent({
        ...content,
        profile: { ...content.profile, politicalStatus: '党'.repeat(321) },
      }),
    ).toThrow();
  });

  it('rejects legacy and out-of-range formatting', () => {
    const content = createDefaultContent();
    expect(() =>
      parseResumeContent({
        ...content,
        formatting: {
          fontSize: 'standard',
          lineHeight: 'standard',
          pageMargin: 'standard',
          sectionGap: 'standard',
          accentColor: 'plum',
        },
      }),
    ).toThrow();
    expect(() =>
      parseResumeContent({
        ...content,
        formatting: { ...content.formatting, bodyFontSizePx: 25 },
      }),
    ).toThrow();
    expect(() =>
      parseResumeContent({
        ...content,
        formatting: { ...content.formatting, accentColor: '#12xyz9' },
      }),
    ).toThrow();
    expect(
      parseResumeContent({
        ...content,
        formatting: {
          ...content.formatting,
          fontFamily: 'source-han-serif',
          accentColor: '#123abc',
        },
      }).formatting,
    ).toMatchObject({ fontFamily: 'source-han-serif', accentColor: '#123abc' });
  });

  it('strictly rejects unknown import fields and malformed dates', () => {
    const content = createDefaultContent();
    const envelope = { version: 4, title: 'Resume', profileAlignment: 'left', content };

    expect(() => parseImportEnvelope({ ...envelope, unknown: true })).toThrow();
    expect(() => parseImportEnvelope({ ...envelope, version: 1 })).toThrow();
    const work = content.sections.find((section) => section.type === 'work');
    if (!work || work.type !== 'work') throw new Error('missing work section');
    work.items.push({
      id: crypto.randomUUID(),
      company: '',
      role: '',
      location: '',
      startDate: '2026-13',
      endDate: '',
      isCurrent: false,
      description: '',
    });
    expect(() => parseImportEnvelope(envelope)).toThrow();
  });

  it('round-trips an optional v4 school logo while keeping legacy imports asset-free', () => {
    const envelope = {
      version: 4 as const,
      title: 'Resume',
      profileAlignment: 'left' as const,
      avatar: null,
      schoolLogo: 'data:image/png;base64,c2Nob29sLWxvZ28=',
      content: createDefaultContent(),
    };
    envelope.content.profile.politicalStatus = '中共党员';

    expect(parseImportEnvelope(envelope).schoolLogo).toBe(envelope.schoolLogo);
    expect(parseImportEnvelope(envelope).content.profile.politicalStatus).toBe('中共党员');
    expect(() =>
      parseImportEnvelope({ ...envelope, schoolLogo: 'data:image/jpeg;base64,bG9nbw==' }),
    ).toThrow();
    const v3Content = structuredClone(createDefaultContent()) as Record<string, unknown>;
    delete (v3Content.profile as Record<string, unknown>).enabled;
    delete (v3Content.profile as Record<string, unknown>).politicalStatus;
    expect(
      parseImportEnvelope({
        version: 3,
        title: 'Legacy',
        profileAlignment: 'left',
        content: v3Content,
      }).schoolLogo,
    ).toBeNull();
  });

  it('rejects the legacy structured skills format', () => {
    const content = createDefaultContent();
    const legacySkills = {
      id: 'skills',
      type: 'skills',
      title: '技能',
      enabled: true,
      items: [{ id: 'skill-1', name: 'TypeScript', level: 'proficient' }],
    };

    expect(() =>
      parseResumeContent({
        ...content,
        sections: content.sections.map((section) =>
          section.type === 'skills' ? legacySkills : section,
        ),
      }),
    ).toThrow();
  });

  it('supports multiple custom sections and stable reordering', () => {
    const first = createCustomSection('志愿经历');
    const second = createCustomSection('出版作品');

    expect(first.id).not.toBe(second.id);
    expect(moveById([first, second], second.id, first.id).map((section) => section.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('only requires a name for completion', () => {
    const content = createDefaultContent();

    expect(completionIssues(content)).toEqual(['请填写姓名', '请至少显示一项有内容的模块']);
    content.profile.fullName = 'Ada';
    for (const section of content.sections) {
      if (section.type === 'work') {
        section.items.push({
          id: crypto.randomUUID(),
          company: '',
          role: '',
          location: '',
          startDate: '',
          endDate: '',
          isCurrent: false,
          description: '',
        });
      }
      if (section.type === 'education') {
        section.items.push({
          id: crypto.randomUUID(),
          school: '',
          major: '',
          degree: '',
          startDate: '',
          endDate: '',
          description: '',
        });
      }
      if (section.type === 'project') {
        section.items.push({
          id: crypto.randomUUID(),
          name: '',
          role: '',
          startDate: '',
          endDate: '',
          isCurrent: false,
          description: '',
        });
      }
      if (section.type === 'awards') {
        section.enabled = true;
        section.items.push({
          id: crypto.randomUUID(),
          title: '',
          issuer: '',
          date: '',
          description: '',
        });
      }
    }
    content.sections.push(createCustomSection('自定义板块'));

    expect(completionIssues(content)).toEqual([]);
  });

  it('migrates v3 profile visibility and validates completion against printable output', () => {
    const legacyContent = structuredClone(createDefaultContent()) as Record<string, unknown>;
    delete (legacyContent.profile as Record<string, unknown>).enabled;
    delete (legacyContent.profile as Record<string, unknown>).politicalStatus;

    expect(parseResumeContent(legacyContent, 3).profile.enabled).toBe(true);

    const content = createDefaultContent();
    content.profile.enabled = false;
    expect(completionIssues(content)).toEqual(['请至少显示一项有内容的模块']);
    const summary = content.sections.find((section) => section.type === 'summary');
    if (!summary || summary.type !== 'summary') throw new Error('missing summary section');
    summary.text = '匿名简历';
    expect(completionIssues(content)).toEqual([]);
    summary.enabled = false;
    expect(completionIssues(content)).toEqual(['请至少显示一项有内容的模块']);
  });

  it('counts a standalone school logo as printable profile content without waiving the name', () => {
    const content = createDefaultContent();

    expect(completionIssues(content, false, true)).toEqual(['请填写姓名']);
    content.profile.enabled = false;
    expect(completionIssues(content, false, true)).toEqual(['请至少显示一项有内容的模块']);
  });
});
