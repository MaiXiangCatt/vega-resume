import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/shared/auth/store/auth.store';

import { ConsolePage } from './ConsolePage';

const resumeServiceMock = vi.hoisted(() => ({
  copy: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  import: vi.fn(),
  list: vi.fn(),
  stats: vi.fn(),
  updateTitle: vi.fn(),
}));

vi.mock('../service/resume.service', () => ({
  resumeErrorMessage: () => '操作失败，请稍后重试',
  resumeService: resumeServiceMock,
}));

const resume = {
  createdAt: '2026-07-20T08:00:00Z',
  exportCount: 0,
  hasAvatar: false,
  hasSchoolLogo: false,
  id: '2b305475-8ed1-428d-bd35-a53957592ba6',
  profileAlignment: 'left' as const,
  revision: 1,
  status: 'completed' as const,
  title: '产品经理简历',
  updatedAt: '2026-07-21T08:00:00Z',
};

function renderConsole() {
  return render(
    <MemoryRouter initialEntries={['/console']}>
      <Routes>
        <Route element={<ConsolePage />} path="/console" />
        <Route element={<p>编辑器占位页</p>} path="/resumes/:resumeId/edit" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConsolePage', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    Object.values(resumeServiceMock).forEach((mock) => mock.mockReset());
    resumeServiceMock.list.mockResolvedValue({ items: [resume], page: 1, pageSize: 6, total: 1 });
    resumeServiceMock.stats.mockResolvedValue({ completed: 1, draft: 0, exported: 0, total: 1 });
    resumeServiceMock.copy.mockResolvedValue({ ...resume, id: 'copy-id', status: 'draft' });
    resumeServiceMock.delete.mockResolvedValue(null);
    resumeServiceMock.updateTitle.mockResolvedValue(resume);
    resumeServiceMock.create.mockResolvedValue({ ...resume, id: 'new-resume-id', status: 'draft' });
  });

  it('shows current-user loading state', () => {
    useAuthStore.getState().setLoading();

    renderConsole();

    expect(screen.getByText('正在加载账号信息')).toBeInTheDocument();
  });

  it('renders remote resume data and the authenticated account', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-token',
      user: { id: 'user-id', username: 'zhangsan', email: 'user@example.com', emailVerified: true },
    });

    renderConsole();

    expect(await screen.findByRole('heading', { name: '产品经理简历' })).toBeInTheDocument();
    expect(screen.getByText('zhangsan')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '我的简历' })).toBeInTheDocument();
  });

  it('sends status filters to the remote list query', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setSession({
      accessToken: 'access-token',
      user: { id: 'user-id', username: 'zhangsan', email: 'user@example.com', emailVerified: true },
    });
    renderConsole();
    await screen.findByRole('heading', { name: '产品经理简历' });

    await user.click(screen.getByRole('button', { name: '已完成' }));

    await waitFor(() => {
      expect(resumeServiceMock.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, status: 'completed' }),
        expect.any(AbortSignal),
      );
    });
  });

  it('creates a draft then navigates to the reserved editor route', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setSession({
      accessToken: 'access-token',
      user: { id: 'user-id', username: 'zhangsan', email: 'user@example.com', emailVerified: true },
    });
    renderConsole();
    await screen.findByRole('heading', { name: '产品经理简历' });

    await user.click(screen.getByRole('button', { name: /创建新简历/ }));

    expect(await screen.findByText('编辑器占位页')).toBeInTheDocument();
    expect(resumeServiceMock.create).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation before deleting a resume', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setSession({
      accessToken: 'access-token',
      user: { id: 'user-id', username: 'zhangsan', email: 'user@example.com', emailVerified: true },
    });
    renderConsole();
    await screen.findByRole('heading', { name: '产品经理简历' });

    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByText(/确认删除“产品经理简历”/)).toBeInTheDocument();
    expect(resumeServiceMock.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(resumeServiceMock.delete).toHaveBeenCalledWith(resume.id));
  });
});
