import { expect, test } from '@playwright/test';

test.use({ viewport: { height: 1000, width: 1440 } });

test('edits and auto-saves a dynamic desktop resume', async ({ page }) => {
  const resumeId = '00000000-0000-0000-0000-000000000101';
  let revision = 1;
  let content = {
    profile: {
      enabled: true,
      fullName: '',
      targetRole: '',
      phone: '',
      email: '',
      location: '',
      politicalStatus: '',
      links: [],
    },
    sections: [
      { id: 'summary', type: 'summary', title: '个人简介', enabled: true, text: '' },
      {
        id: 'work',
        type: 'work',
        title: '工作经历',
        enabled: true,
        items: [
          {
            id: 'work-1',
            company: '甲公司',
            role: '前端实习生',
            location: '杭州',
            startDate: '2025-01',
            endDate: '2025-03',
            isCurrent: false,
            description: '负责编辑器体验。',
          },
          {
            id: 'work-2',
            company: '乙公司',
            role: '前端实习生',
            location: '上海',
            startDate: '2025-04',
            endDate: '2025-06',
            isCurrent: false,
            description: '负责 PDF 渲染。',
          },
        ],
      },
      { id: 'education', type: 'education', title: '教育背景', enabled: true, items: [] },
      { id: 'project', type: 'project', title: '项目经历', enabled: true, items: [] },
      { id: 'skills', type: 'skills', title: '技能', enabled: true, description: '' },
      { id: 'awards', type: 'awards', title: '奖项荣誉', enabled: false, items: [] },
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
  };
  let title = '产品设计师简历';
  let profileAlignment = 'left';
  let hasSchoolLogo = false;

  const detail = () => ({
    id: resumeId,
    title,
    status: 'draft',
    revision,
    hasAvatar: true,
    hasSchoolLogo,
    profileAlignment,
    exportCount: 0,
    contentVersion: 4,
    content,
    createdAt: '2026-07-22T00:00:00Z',
    updatedAt: '2026-07-22T00:00:00Z',
  });
  const ok = (data: unknown) => JSON.stringify({ code: 0, message: '', data });

  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: ok({
        accessToken: 'access-token',
        user: { id: 'user-1', username: 'qingqing', email: 'qingqing@example.com' },
      }),
    }),
  );
  await page.route(`**/api/resumes/${resumeId}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as {
        content: typeof content;
        expectedRevision: number;
        profileAlignment: string;
        title: string;
      };
      expect(body.expectedRevision).toBe(revision);
      content = body.content;
      profileAlignment = body.profileAlignment;
      title = body.title;
      revision += 1;
    }
    await route.fulfill({ contentType: 'application/json', status: 200, body: ok(detail()) });
  });
  await page.route(`**/api/resumes/${resumeId}/export/pdf`, async (route) => {
    await route.fulfill({
      contentType: 'application/pdf',
      status: 200,
      body: '%PDF-1.7 mocked export',
    });
  });
  await page.route(`**/api/resumes/${resumeId}/avatar`, async (route) => {
    await route.fulfill({
      contentType: 'image/png',
      path: 'src/pages/home/assets/hero.png',
      status: 200,
    });
  });
  await page.route(`**/api/resumes/${resumeId}/school-logo`, async (route) => {
    if (route.request().method() === 'PUT') {
      hasSchoolLogo = true;
      await route.fulfill({ contentType: 'application/json', status: 200, body: ok(detail()) });
      return;
    }
    if (route.request().method() === 'DELETE') {
      hasSchoolLogo = false;
      await route.fulfill({ contentType: 'application/json', status: 200, body: ok(detail()) });
      return;
    }
    await route.fulfill({
      contentType: 'image/png',
      path: 'src/pages/home/assets/hero.png',
      status: 200,
    });
  });

  await page.goto(`/resumes/${resumeId}/edit`);
  await expect(page.getByRole('heading', { name: '基本信息' })).toBeVisible();
  const preview = page.getByLabel('产品设计师简历 A4 实时预览');
  await expect(preview).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);

  await page.getByLabel('上传校徽原图').setInputFiles('src/pages/home/assets/hero.png');
  const schoolLogoCropDialog = page.getByRole('dialog', { name: '裁剪校徽' });
  await expect(schoolLogoCropDialog).toBeVisible();
  await schoolLogoCropDialog.getByRole('button', { name: '确认校徽' }).click();
  await expect(schoolLogoCropDialog).not.toBeVisible();
  await expect.poll(() => hasSchoolLogo).toBe(true);
  await expect(page.getByAltText('学校校徽')).toBeVisible();

  await page.getByLabel('姓名').fill('林清清');
  await page.getByLabel('目标岗位').fill('产品设计师');
  await page.getByLabel('政治面貌').fill('中共党员');
  await expect(preview.getByRole('heading', { name: '林清清' })).toBeVisible();
  await expect(preview.getByText('产品设计师')).toBeVisible();
  await expect(preview.getByText('政治面貌：中共党员')).toBeVisible();
  await expect.poll(() => revision, { timeout: 5000 }).toBeGreaterThan(1);
  await expect.poll(() => content.profile.politicalStatus, { timeout: 5000 }).toBe('中共党员');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '隐藏 基本信息' }).click();
  await expect(page.getByText('“基本信息”当前已隐藏')).toBeVisible();
  await expect(preview.getByRole('heading', { name: '林清清' })).toHaveCount(0);
  await expect.poll(() => content.profile.enabled, { timeout: 5000 }).toBe(false);
  await page.getByRole('button', { name: '恢复显示' }).click();
  await expect(preview.getByRole('heading', { name: '林清清' })).toBeVisible();

  await page.getByRole('button', { name: '添加板块' }).click();
  const addSectionDialog = page.getByRole('dialog', { name: '添加自定义板块' });
  await addSectionDialog.getByRole('textbox', { name: '自定义板块' }).fill('志愿经历');
  await addSectionDialog.getByRole('button', { name: '创建' }).click();
  await expect(page.getByRole('heading', { name: '志愿经历' })).toBeVisible();
  await page.getByLabel('标题', { exact: true }).fill('开源社区设计志愿者');
  await page.getByRole('button', { name: '开始时间' }).click();
  const currentYear = new Date().getFullYear();
  await page.screenshot({ path: 'test-results/resume-month-picker.png', fullPage: true });
  await page.getByRole('button', { name: `${currentYear} 年 1 月` }).click();
  await expect(page.getByRole('button', { name: '开始时间' })).toContainText(
    `${currentYear} 年 01 月`,
  );
  await expect
    .poll(() => content.sections.some((section) => section.type === 'custom'), { timeout: 5000 })
    .toBe(true);

  await page.getByRole('button', { name: /^工作经历(?: |$)/ }).click();
  await page.getByRole('button', { name: '隐藏 工作经历' }).click();
  await expect(preview.getByRole('heading', { name: '工作经历' })).toHaveCount(0);
  await expect(page.getByText('“工作经历”当前已隐藏')).toBeVisible();
  await page.getByRole('button', { name: '恢复显示' }).click();
  await expect(preview.getByRole('heading', { name: '工作经历' })).toBeVisible();
  await page.getByRole('spinbutton', { name: '与上一条记录间距' }).fill('12');
  await page.getByRole('spinbutton', { name: '与上一条记录间距' }).blur();
  await expect
    .poll(
      () =>
        (
          content.sections.find((section) => section.type === 'work')?.items?.[1] as
            { spacingBeforePx?: number } | undefined
        )?.spacingBeforePx,
      { timeout: 5000 },
    )
    .toBe(12);

  await page.screenshot({ path: 'test-results/resume-editor-desktop.png', fullPage: true });

  const modernDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF' }).click();
  await (await modernDownload).saveAs('test-results/resume-modern-editorial.pdf');

  await page.getByRole('button', { name: '排版设置' }).click();
  const formattingDialog = page.getByRole('dialog', { name: '排版设置' });
  const formattingDialogBeforeDrag = await formattingDialog.boundingBox();
  const formattingDragHandle = formattingDialog.getByRole('button', {
    name: '拖动排版设置弹窗',
  });
  const formattingDialogBody = formattingDialog.locator('[data-slot="formatting-dialog-body"]');
  const formattingDragHandleBeforeScroll = await formattingDragHandle.boundingBox();
  await formattingDialogBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const formattingDragHandleAfterScroll = await formattingDragHandle.boundingBox();
  expect(formattingDragHandleAfterScroll?.y).toBe(formattingDragHandleBeforeScroll?.y);
  await formattingDialogBody.evaluate((element) => {
    element.scrollTop = 0;
  });
  const formattingDragHandleBox = await formattingDragHandle.boundingBox();
  if (!formattingDialogBeforeDrag || !formattingDragHandleBox) {
    throw new Error('排版设置弹窗未生成可测量的拖拽布局');
  }
  await page.mouse.move(
    formattingDragHandleBox.x + formattingDragHandleBox.width / 2,
    formattingDragHandleBox.y + formattingDragHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    formattingDragHandleBox.x + formattingDragHandleBox.width / 2 - 280,
    formattingDragHandleBox.y + formattingDragHandleBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await formattingDialog.boundingBox())?.x)
    .toBeLessThan(formattingDialogBeforeDrag.x - 200);
  await expect(preview).toBeVisible();

  await formattingDialog.getByLabel('姓名', { exact: true }).fill('24');
  await expect(preview.locator('h1', { hasText: '林清清' })).toHaveCSS('font-size', '24px');
  await page.getByRole('combobox', { name: '基本信息布局' }).click();
  await page.getByRole('option', { name: '居中对齐' }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect.poll(() => profileAlignment, { timeout: 5000 }).toBe('center');
  await expect(preview).toHaveAttribute('data-profile-alignment', 'center');
  await expect(preview.locator('header img').last()).toBeVisible();
  const previewBox = await preview.boundingBox();
  const nameBox = await preview.getByRole('heading', { name: '林清清' }).boundingBox();
  if (!previewBox || !nameBox) throw new Error('经典模板预览未生成可测量的布局');
  const previewCenter = previewBox.x + previewBox.width / 2;
  const nameCenter = nameBox.x + nameBox.width / 2;
  expect(Math.abs(nameCenter - previewCenter)).toBeLessThan(1);
  await page.screenshot({ path: 'test-results/resume-editor-classic-desktop.png', fullPage: true });

  const classicDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF' }).click();
  await (await classicDownload).saveAs('test-results/resume-classic-professional.pdf');

  await page.getByRole('button', { name: '排版设置' }).click();
  await page.getByRole('combobox', { name: '基本信息布局' }).click();
  await page.getByRole('option', { name: '右侧对齐' }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect.poll(() => profileAlignment, { timeout: 5000 }).toBe('right');
  await expect(preview).toHaveAttribute('data-profile-alignment', 'right');
  const rightPhotoBox = await preview.locator('header img').first().boundingBox();
  const rightSchoolLogoBox = await preview.locator('header img').last().boundingBox();
  const rightNameBox = await preview.getByRole('heading', { name: '林清清' }).boundingBox();
  if (!rightPhotoBox || !rightSchoolLogoBox || !rightNameBox)
    throw new Error('右对齐头像与校徽布局未生成可测量元素');
  expect(rightPhotoBox.x).toBeLessThan(rightNameBox.x);
  expect(rightSchoolLogoBox.x).toBeGreaterThan(rightNameBox.x);

  const rightDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF' }).click();
  await (await rightDownload).saveAs('test-results/resume-right-custom-spacing.pdf');
});
