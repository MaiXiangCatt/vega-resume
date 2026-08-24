/// <reference types="node" />

import { resolve } from 'node:path';
import { cloneElement, type ReactElement } from 'react';
import { Font, pdf } from '@react-pdf/renderer';
import { beforeAll, describe, expect, it } from 'vitest';

import { createDefaultContent } from '../model/resume.model';
import type { ResumeDocument } from '../model/resume.types';
import { ResumePdfDocument } from '../ui/ResumePdfDocument';
import { createResumePdfBlob } from './resume-pdf.service';

beforeAll(() => {
  const sansRegularPath = resolve(process.cwd(), 'public/fonts/NotoSansSC-Pdf-Regular.ttf');
  const sansBoldPath = resolve(process.cwd(), 'public/fonts/NotoSansSC-Pdf-Bold.ttf');
  const serifRegularPath = resolve(process.cwd(), 'public/fonts/NotoSerifSC-Pdf-Regular.ttf');
  const serifBoldPath = resolve(process.cwd(), 'public/fonts/NotoSerifSC-Pdf-Bold.ttf');
  Font.clear();
  Font.register({
    family: 'Helvetica',
    fonts: [
      { fontWeight: 400, src: 'Helvetica' },
      { fontWeight: 700, src: 'Helvetica-Bold' },
      { fontStyle: 'italic', fontWeight: 400, src: 'Helvetica-Oblique' },
      { fontStyle: 'italic', fontWeight: 700, src: 'Helvetica-BoldOblique' },
    ],
  });
  Font.register({
    family: 'NotoSansSC',
    fonts: [
      { fontWeight: 400, src: sansRegularPath },
      { fontWeight: 700, src: sansBoldPath },
      { fontStyle: 'italic', fontWeight: 400, src: sansRegularPath },
      { fontStyle: 'italic', fontWeight: 700, src: sansBoldPath },
    ],
  });
  Font.register({
    family: 'NotoSerifSC',
    fonts: [
      { fontWeight: 400, src: serifRegularPath },
      { fontWeight: 700, src: serifBoldPath },
      { fontStyle: 'italic', fontWeight: 400, src: serifRegularPath },
      { fontStyle: 'italic', fontWeight: 700, src: serifBoldPath },
    ],
  });
});

function createResume(profileAlignment: ResumeDocument['profileAlignment']): ResumeDocument {
  const content = createDefaultContent();
  content.profile = {
    enabled: true,
    fullName: '林清清',
    targetRole: '前端开发工程师',
    phone: '13800000000',
    email: 'qingqing@example.com',
    location: '杭州',
    politicalStatus: '中共党员',
    links: [],
  };
  const summary = content.sections.find((section) => section.type === 'summary');
  if (summary?.type === 'summary') {
    summary.text = '负责**设计系统**\n\n- 建立规范\n- 推动交付';
  }
  return {
    id: 'guest-primary',
    title: 'Markdown 简历',
    status: 'draft',
    revision: 1,
    hasAvatar: false,
    hasSchoolLogo: false,
    profileAlignment,
    exportCount: 0,
    contentVersion: 4,
    content,
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
  };
}

describe('createResumePdfBlob', () => {
  it('renders political status into the PDF layout', async () => {
    const resume = createResume('left');
    let layout: PdfLayoutNode | undefined;
    const document = ResumePdfDocument({ avatar: null, resume }) as ReactElement<
      Record<string, unknown>
    >;
    const renderedDocument = cloneElement(document, {
      onRender: (result: { _INTERNAL__LAYOUT__DATA_?: PdfLayoutNode }) => {
        layout = result._INTERNAL__LAYOUT__DATA_;
      },
    });

    await pdf(renderedDocument).toBlob();

    expect(collectTextLayouts(layout).some(([, text]) => text === '政治面貌：中共党员')).toBe(true);
  });

  it('wraps long CJK Markdown paragraphs onto multiple lines', async () => {
    const resume = createResume('left');
    const summary = resume.content.sections.find((section) => section.type === 'summary');
    const longSummary = '这是一段没有任何空格并且长度足够超过页面宽度的中文描述'.repeat(5);
    if (summary?.type === 'summary') {
      summary.text = longSummary;
    }
    let layout: PdfLayoutNode | undefined;
    const document = ResumePdfDocument({ avatar: null, resume }) as ReactElement<
      Record<string, unknown>
    >;
    const renderedDocument = cloneElement(document, {
      onRender: (result: { _INTERNAL__LAYOUT__DATA_?: PdfLayoutNode }) => {
        layout = result._INTERNAL__LAYOUT__DATA_;
      },
    });

    await pdf(renderedDocument).toBlob();
    const summaryLayout = collectTextLayouts(layout).find(([, text]) => text === longSummary);

    expect(summaryLayout?.[0]).toBeGreaterThan(1);
  });

  it.each(['left', 'center', 'right'] as const)(
    'generates a valid %s PDF with Markdown',
    async (profileAlignment) => {
      const blob = await createResumePdfBlob(createResume(profileAlignment), null);
      const signature = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 4));

      expect(blob.type).toBe('application/pdf');
      expect(signature).toBe('%PDF');
      expect(blob.size).toBeGreaterThan(1_000);
    },
    20_000,
  );

  it('embeds a cropped JPEG avatar', async () => {
    const onePixelJpeg =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';
    const blob = await createResumePdfBlob(
      { ...createResume('left'), hasAvatar: true },
      onePixelJpeg,
    );

    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(1_000);
  }, 20_000);
});

type PdfLayoutNode = {
  children?: PdfLayoutNode[];
  lines?: unknown[];
  type?: string;
  value?: string;
};

function collectTextLayouts(node: PdfLayoutNode | undefined): Array<[number, string]> {
  if (!node) return [];
  const own =
    node.type === 'TEXT' ? [[node.lines?.length ?? 0, collectText(node)] as [number, string]] : [];
  return [...own, ...(node.children ?? []).flatMap((child) => collectTextLayouts(child))];
}

function collectText(node: PdfLayoutNode): string {
  if (node.type === 'TEXT_INSTANCE') return node.value ?? '';
  return (node.children ?? []).map(collectText).join('');
}
