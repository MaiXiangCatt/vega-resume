import { expect, test } from '@playwright/test';

test.use({ viewport: { height: 1000, width: 1440 } });

test('prints a short resume on a white page without leaking the token into the request URL', async ({
  page,
}) => {
  const resumeId = '00000000-0000-0000-0000-000000000102';
  const printToken = 'one-time-print-token';
  let printRequests = 0;
  const ok = (data: unknown) => JSON.stringify({ code: 0, message: '', data });

  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      contentType: 'application/json',
      status: 401,
      body: JSON.stringify({ code: 100003, message: '未登录', data: null }),
    }),
  );
  await page.route(`**/api/resumes/${resumeId}/print`, async (route) => {
    printRequests += 1;
    expect(route.request().url()).not.toContain(printToken);
    expect(route.request().headers()['x-print-token']).toBe(printToken);
    await route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: ok({
        avatarDataUrl: null,
        schoolLogoDataUrl: null,
        resume: {
          id: resumeId,
          title: '短简历',
          status: 'draft',
          revision: 1,
          hasAvatar: false,
          hasSchoolLogo: false,
          profileAlignment: 'left',
          templateId: 'modern-editorial',
          exportCount: 0,
          contentVersion: 4,
          content: {
            profile: {
              enabled: true,
              fullName: '林清清',
              targetRole: '前端工程师',
              phone: '13800000000',
              email: 'qingqing@example.com',
              location: '杭州',
              politicalStatus: '中共党员',
              links: [],
            },
            sections: [
              {
                id: 'summary',
                type: 'summary',
                title: '个人简介',
                enabled: true,
                text: '一份用于验证短内容页面底色的简历。',
              },
            ],
            formatting: {
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
            },
          },
          createdAt: '2026-07-22T00:00:00Z',
          updatedAt: '2026-07-22T00:00:00Z',
        },
      }),
    });
  });

  await page.goto(`/print/resumes/${resumeId}#token=${printToken}`);
  await expect(page.locator('body')).toHaveAttribute('data-print-ready', 'true');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#root')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  const preview = page.getByLabel('短简历 A4 实时预览');
  await expect(preview).toBeVisible();
  await expect(preview.getByText('政治面貌：中共党员')).toBeVisible();
  await expect(preview).toHaveCSS('width', '1440px');
  expect(printRequests).toBe(1);

  const pdf = await page.pdf({
    format: 'A4',
    path: 'test-results/print-short-resume.pdf',
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
});
