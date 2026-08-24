import 'fake-indexeddb/auto';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/shared/auth/store/auth.store';
import { useRegistrationStore } from '@/shared/auth/store/registration.store';
import { createDefaultContent } from '@/pages/resume-editor/model/resume.model';
import { openLocalDatabase } from '@/pages/resume-editor/service/local-resume.service';
import { localResumeStore } from '@/pages/resume-editor/store/local-resume.store';

import { AppRoutes } from './App';

const authServiceMock = vi.hoisted(() => ({
  confirmEmailVerification: vi.fn(),
  getRegistrationPolicy: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  register: vi.fn(),
  resendEmailVerification: vi.fn(),
  sendRegistrationEmailVerification: vi.fn(),
}));

vi.mock('@/shared/auth/api/auth.service', () => ({
  authService: authServiceMock,
}));

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('app auth flow integration', () => {
  beforeEach(async () => {
    await localResumeStore.clear();
    useAuthStore.getState().reset();
    useRegistrationStore.getState().reset();
    authServiceMock.confirmEmailVerification.mockReset();
    authServiceMock.getRegistrationPolicy.mockReset();
    authServiceMock.login.mockReset();
    authServiceMock.logout.mockReset();
    authServiceMock.refresh.mockReset();
    authServiceMock.register.mockReset();
    authServiceMock.resendEmailVerification.mockReset();
    authServiceMock.sendRegistrationEmailVerification.mockReset();
    authServiceMock.refresh.mockRejectedValue(new Error('no session'));
    authServiceMock.getRegistrationPolicy.mockResolvedValue({
      challengeAvailable: true,
      mode: 'open',
    });
  });

  it('renders unauthenticated home after failed bootstrap', async () => {
    renderApp('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: /LittleAgResume/ }),
    ).toBeInTheDocument();
  });

  it('fails registration policy loading closed without blocking login or local entry', async () => {
    const user = userEvent.setup();
    authServiceMock.getRegistrationPolicy.mockRejectedValueOnce(new Error('policy unavailable'));
    renderApp('/');

    await user.click(await screen.findByRole('button', { name: '免费开始' }));
    expect(await screen.findByText('注册暂未开放，已有账号仍可正常登录。')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '登录' })).toBeInTheDocument();
  });

  it('registers from home and lands on console', async () => {
    const user = userEvent.setup();
    authServiceMock.sendRegistrationEmailVerification.mockResolvedValueOnce({
      email: 'user@example.com',
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    });
    authServiceMock.register.mockResolvedValueOnce({
      accessToken: 'access-token',
      user: { id: 'user-id', username: 'zhangsan', email: 'user@example.com', emailVerified: true },
    });

    renderApp('/');

    await user.click(await screen.findByRole('button', { name: '免费开始' }));
    await user.type(screen.getByLabelText('邮箱'), 'user@example.com');
    await user.click(
      screen.getByRole('checkbox', { name: '同意用户服务协议及内容规则和隐私政策' }),
    );
    await user.click(screen.getByRole('checkbox', { name: '单独同意个人信息跨境处理说明' }));
    await user.click(screen.getByRole('button', { name: '发送验证码' }));
    await user.type(screen.getByLabelText('用户名'), 'zhangsan');
    await user.type(screen.getByLabelText('密码'), 'password1');
    await user.type(screen.getByLabelText('确认密码'), 'password1');
    await user.type(await screen.findByLabelText('邮箱验证码'), '123456');
    await user.click(screen.getByRole('button', { name: '验证并创建账号' }));

    expect(await screen.findByText('zhangsan')).toBeInTheDocument();
  });

  it('logs in from home and lands on console', async () => {
    const user = userEvent.setup();
    authServiceMock.login.mockResolvedValueOnce({
      accessToken: 'access-token',
      user: { id: 'user-id', username: 'zhangsan', email: 'user@example.com', emailVerified: true },
    });

    renderApp('/');

    await user.click(await screen.findByRole('button', { name: '登录' }));
    await user.type(screen.getByLabelText('邮箱'), 'user@example.com');
    await user.type(screen.getByLabelText('密码'), 'password1');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('zhangsan')).toBeInTheDocument();
  });

  it('restores a refresh-cookie session on console', async () => {
    authServiceMock.refresh.mockResolvedValueOnce({
      accessToken: 'access-token',
      user: { id: 'user-id', username: 'zhangsan', email: 'user@example.com', emailVerified: true },
    });

    renderApp('/console');

    expect(await screen.findByText('zhangsan')).toBeInTheDocument();
  });

  it('logs out and returns to home', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setSession({
      accessToken: 'access-token',
      user: { id: 'user-id', username: 'zhangsan', email: 'user@example.com', emailVerified: true },
    });
    authServiceMock.logout.mockResolvedValueOnce(undefined);

    renderApp('/console');

    await user.click(await screen.findByRole('button', { name: /zhangsan/ }));
    await user.click(await screen.findByRole('menuitem', { name: /退出登录/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: /LittleAgResume/ }),
    ).toBeInTheDocument();
    expect(authServiceMock.logout).toHaveBeenCalledTimes(1);
  });

  it('opens the empty local console without an authenticated session or resume API calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderApp('/local');

    expect(
      await screen.findByRole('heading', { name: '我的简历' }, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('仅存此浏览器')).toBeInTheDocument();
    expect(await screen.findByText('创建新简历')).toBeInTheDocument();
    expect(screen.queryByLabelText('账号菜单')).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('/api/resumes'))).toBe(
      false,
    );

    fetchSpy.mockRestore();
  });

  it('keeps the local console available to an authenticated user', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-token',
      user: {
        id: 'user-id',
        username: 'zhangsan',
        email: 'user@example.com',
        emailVerified: true,
      },
    });

    renderApp('/local');

    expect(await screen.findByRole('heading', { name: '我的简历' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '云端控制台' })).toBeInTheDocument();
    expect(screen.queryByLabelText('账号菜单')).not.toBeInTheDocument();
  });

  it('redirects the legacy guest entry to the empty local console when no old resume exists', async () => {
    renderApp('/guest/edit');

    expect(await screen.findByRole('heading', { name: '我的简历' })).toBeInTheDocument();
    expect(await screen.findByText('创建新简历')).toBeInTheDocument();
  });

  it('redirects the legacy guest entry to its existing local resume', async () => {
    const database = await openLocalDatabase();
    await database.put('guest-resume', {
      key: 'primary',
      storageVersion: 1,
      document: {
        id: 'guest-primary',
        title: '旧版简历',
        status: 'draft',
        revision: 1,
        hasAvatar: false,
        templateId: 'modern-editorial',
        exportCount: 0,
        contentVersion: 2,
        content: (() => {
          const content = createDefaultContent();
          const profile = { ...content.profile } as Partial<typeof content.profile>;
          delete profile.enabled;
          delete profile.politicalStatus;
          const formatting = { ...content.formatting } as Partial<typeof content.formatting>;
          delete formatting.entryGapPx;
          return { ...content, profile, formatting };
        })(),
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
    });
    database.close();

    renderApp('/guest/edit');

    expect(await screen.findByLabelText('简历标题', {}, { timeout: 5_000 })).toHaveValue(
      '旧版简历',
    );
    expect(screen.getByText('本地模式')).toBeInTheDocument();
  });

  it('redirects authenticated home visits and protects console failures', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-token',
      user: { id: 'user-id', username: 'zhangsan', email: 'user@example.com', emailVerified: true },
    });

    const { unmount } = renderApp('/');
    expect(await screen.findByText('zhangsan')).toBeInTheDocument();
    unmount();

    useAuthStore.getState().reset();
    authServiceMock.refresh.mockRejectedValueOnce(new Error('no session'));
    renderApp('/console');

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: /LittleAgResume/ })).toBeInTheDocument(),
    );
  });
});
