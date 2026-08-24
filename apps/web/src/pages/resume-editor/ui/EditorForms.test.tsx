import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultContent, createSectionItem } from '../model/resume.model';
import type { SkillsSection, WorkItem, WorkSection } from '../model/resume.types';
import { ProfileEditor, SectionEditor } from './EditorForms';

describe('ProfileEditor', () => {
  it('edits the optional political status as free text', () => {
    const onChange = vi.fn();
    const profile = createDefaultContent().profile;

    render(
      <ProfileEditor
        avatar={null}
        onAvatar={vi.fn()}
        onChange={onChange}
        onDeleteAvatar={vi.fn()}
        onDeleteSchoolLogo={vi.fn()}
        onSchoolLogo={vi.fn()}
        profile={profile}
        schoolLogo={null}
      />,
    );

    const input = screen.getByRole('textbox', { name: '政治面貌' });
    expect(input).toHaveAttribute('placeholder', '如：中共党员');
    fireEvent.change(input, { target: { value: '中共党员' } });

    expect(onChange).toHaveBeenLastCalledWith({ ...profile, politicalStatus: '中共党员' });
  });
});

describe('SectionEditor', () => {
  it('edits skills as one Markdown description', () => {
    const onChange = vi.fn();
    const section: SkillsSection = {
      id: 'skills',
      type: 'skills',
      title: '技能',
      enabled: true,
      description: '',
    };

    render(
      <SectionEditor
        defaultEntryGapPx={14}
        defaultSectionGapPx={8}
        onChange={onChange}
        section={section}
      />,
    );

    const editor = screen.getByRole('textbox', { name: '技能内容' });
    fireEvent.change(editor, { target: { value: '**TypeScript**' } });

    expect(onChange).toHaveBeenLastCalledWith({
      ...section,
      description: '**TypeScript**',
    });
    expect(screen.queryByRole('button', { name: /新增一条技能/ })).not.toBeInTheDocument();
  });

  it('supports inherited and explicit section and record spacing', () => {
    const onChange = vi.fn();
    const work = createDefaultContent().sections.find(
      (section): section is WorkSection => section.type === 'work',
    );
    if (!work) throw new Error('missing work section');
    work.items = [createSectionItem('work') as WorkItem, createSectionItem('work') as WorkItem];

    render(
      <SectionEditor
        defaultEntryGapPx={14}
        defaultSectionGapPx={8}
        onChange={onChange}
        section={work}
      />,
    );

    expect(screen.getByRole('spinbutton', { name: '模块上方间距' })).toHaveAttribute(
      'placeholder',
      '默认 8',
    );
    expect(screen.getAllByRole('spinbutton', { name: '与上一条记录间距' })).toHaveLength(1);

    const sectionGap = screen.getByRole('spinbutton', { name: '模块上方间距' });
    fireEvent.change(sectionGap, { target: { value: '0' } });
    fireEvent.blur(sectionGap);
    expect(onChange).toHaveBeenLastCalledWith({ ...work, spacingBeforePx: 0 });
  });
});
