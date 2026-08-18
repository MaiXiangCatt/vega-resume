import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createCustomSection, createDefaultContent } from '../model/resume.model';
import { StructurePanel } from './StructurePanel';

describe('StructurePanel visibility controls', () => {
  it('keeps hidden modules available and exposes accessible visibility actions', async () => {
    const user = userEvent.setup();
    const content = createDefaultContent();
    const work = content.sections.find((section) => section.type === 'work');
    if (!work) throw new Error('missing work section');
    work.enabled = false;
    const custom = createCustomSection('志愿经历');
    content.sections.push(custom);
    const onSelect = vi.fn();
    const onToggleProfile = vi.fn();
    const onToggleSection = vi.fn();
    const onRemove = vi.fn();

    render(
      <StructurePanel
        activeId="profile"
        hasAvatar={false}
        hasSchoolLogo={false}
        onAdd={vi.fn()}
        onFormat={vi.fn()}
        onMove={vi.fn()}
        onRemove={onRemove}
        onSelect={onSelect}
        onToggleProfile={onToggleProfile}
        onToggleSection={onToggleSection}
        profile={content.profile}
        sections={content.sections}
      />,
    );

    expect(screen.getByRole('button', { name: '隐藏 基本信息' })).toBeVisible();
    expect(screen.getByRole('button', { name: '显示 工作经历' })).toBeVisible();
    expect(screen.getByText('工作经历')).toBeVisible();
    expect(screen.getAllByText('不会输出').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '永久删除 工作经历' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '永久删除 志愿经历' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '显示 工作经历' }));
    expect(onToggleSection).toHaveBeenCalledWith(work);

    await user.click(screen.getByText('工作经历'));
    expect(onSelect).toHaveBeenCalledWith('work');

    await user.click(screen.getByRole('button', { name: '永久删除 志愿经历' }));
    expect(onRemove).toHaveBeenCalledWith(custom);
  });
});
