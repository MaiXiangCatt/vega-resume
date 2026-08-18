import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultContent } from '../model/resume.model';
import type { ResumeDocument } from '../model/resume.types';
import { FormattingDialog } from './ResumeEditorPage';

function createResume(): ResumeDocument {
  return {
    id: 'resume-1',
    title: '测试简历',
    status: 'draft',
    revision: 1,
    hasAvatar: false,
    hasSchoolLogo: false,
    profileAlignment: 'center',
    exportCount: 0,
    contentVersion: 4,
    content: createDefaultContent(),
    createdAt: '2026-07-23T00:00:00Z',
    updatedAt: '2026-07-23T00:00:00Z',
  };
}

function FormattingFixture() {
  const [resume, setResume] = useState(createResume);
  return (
    <FormattingDialog
      document={resume}
      onChange={(formatting) =>
        setResume((current) => ({
          ...current,
          content: { ...current.content, formatting },
        }))
      }
      onClose={vi.fn()}
      onProfileAlignment={(profileAlignment) =>
        setResume((current) => ({ ...current, profileAlignment }))
      }
    />
  );
}

describe('FormattingDialog', () => {
  it('updates independent numeric fields and restores defaults', async () => {
    const user = userEvent.setup();
    render(<FormattingFixture />);
    const nameSize = screen.getByRole('spinbutton', { name: '姓名' });
    const leftMargin = screen.getByRole('spinbutton', { name: '左' });
    const entryGap = screen.getByRole('spinbutton', { name: '默认记录间距' });

    expect(screen.getByRole('combobox', { name: '基本信息布局' })).toHaveTextContent('居中对齐');
    expect(screen.getByRole('button', { name: '拖动排版设置弹窗' })).toBeInTheDocument();

    await user.clear(nameSize);
    await user.type(nameSize, '24');
    await user.tab();
    await user.clear(leftMargin);
    await user.type(leftMargin, '42');
    await user.tab();

    expect(nameSize).toHaveValue(24);
    expect(leftMargin).toHaveValue(42);
    expect(entryGap).toHaveValue(14);

    await user.clear(nameSize);
    await user.tab();
    expect(nameSize).toHaveValue(24);

    await user.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(screen.getByRole('spinbutton', { name: '姓名' })).toHaveValue(20);
    expect(screen.getByRole('spinbutton', { name: '左' })).toHaveValue(33);
    expect(screen.getByRole('combobox', { name: '基本信息布局' })).toHaveTextContent('左侧对齐');
  });

  it('exposes the resume font selector and supports preset and custom colors', async () => {
    const user = userEvent.setup();
    render(<FormattingFixture />);

    expect(screen.getByRole('combobox', { name: '字体' })).toHaveTextContent('思源黑体');

    await user.click(screen.getByRole('button', { name: '选择纯黑主题色' }));
    expect(screen.getByLabelText('自定义主题色')).toHaveValue('#000000');

    fireEvent.change(screen.getByLabelText('自定义主题色'), {
      target: { value: '#123456' },
    });
    expect(screen.getByLabelText('自定义主题色')).toHaveValue('#123456');
  });
});
