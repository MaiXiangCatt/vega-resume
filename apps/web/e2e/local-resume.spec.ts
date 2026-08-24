import { readFile } from 'node:fs/promises';

import { devices, expect, test, type Locator, type Page } from '@playwright/test';

test('local resume persists, refreshes PDF preview and downloads the current PDF', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const workerRequests: string[] = [];
  const resumeApiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/resumes')) resumeApiRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (response.url().includes('pdf.worker')) workerRequests.push(response.url());
  });
  await page.goto('/');
  expect(workerRequests).toHaveLength(0);
  await page.getByRole('button', { name: '进入本地模式' }).click();

  await expect(page).toHaveURL(/\/local$/);
  await expect(page.getByText('仅存此浏览器')).toBeVisible();
  await page.getByRole('button', { name: '创建新简历' }).click();

  await expect(page).toHaveURL(/\/local\/resumes\/[^/]+\/edit$/);
  await expect(page.getByText('本地模式')).toBeVisible();

  const title = page.getByLabel('简历标题');
  await expect(title).toHaveValue('未命名简历');
  const initialPreview = visibleCanvasPreview(page);
  await expect(initialPreview).toBeVisible({ timeout: 30_000 });
  const initialKey = await initialPreview.getAttribute('data-preview-key');
  await expect(initialPreview.getByRole('img', { name: 'PDF 第 1 页预览' })).toHaveAttribute(
    'data-rendered',
    'true',
    { timeout: 30_000 },
  );
  await expect.poll(() => workerRequests.length).toBeGreaterThan(0);
  await expect(page.locator('iframe, object, embed')).toHaveCount(0);

  await title.fill('本地前端简历');
  await page.getByLabel('姓名').fill('测试名字');
  await page.getByLabel('目标岗位').fill('全站开发工程师');
  await page.getByLabel('手机号').fill('12345');
  await page.getByLabel('邮箱').fill('local@example.com');
  await page.getByLabel('政治面貌').fill('群众');
  await expect
    .poll(async () => visibleCanvasPreview(page).getAttribute('data-preview-key'), {
      timeout: 30_000,
    })
    .not.toBe(initialKey);
  await expect
    .poll(() =>
      canvasHasInk(visibleCanvasPreview(page).getByRole('img', { name: 'PDF 第 1 页预览' })),
    )
    .toBe(true);

  await page.reload();
  await expect(page.getByLabel('简历标题')).toHaveValue('本地前端简历');
  await expect(page.getByLabel('姓名')).toHaveValue('测试名字');
  await expect(page.getByLabel('政治面貌')).toHaveValue('群众');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('本地前端简历.pdf');
  const currentPdfPath = testInfo.outputPath('local-resume-current.pdf');
  await download.saveAs(currentPdfPath);
  expect((await readFile(currentPdfPath)).subarray(0, 4).toString()).toBe('%PDF');

  const sansPreviewKey = await visibleCanvasPreview(page).getAttribute('data-preview-key');
  await page.getByLabel('上传头像原图').setInputFiles('src/pages/home/assets/hero.png');
  const cropDialog = page.getByRole('dialog', { name: '裁剪简历头像' });
  await expect(cropDialog).toBeVisible();
  await cropDialog.getByRole('button', { name: '确认头像' }).click();
  await expect(cropDialog).not.toBeVisible();

  await page.getByLabel('上传校徽原图').setInputFiles('src/pages/home/assets/hero.png');
  const schoolLogoCropDialog = page.getByRole('dialog', { name: '裁剪校徽' });
  await expect(schoolLogoCropDialog).toBeVisible();
  await schoolLogoCropDialog.getByRole('button', { name: '确认校徽' }).click();
  await expect(schoolLogoCropDialog).not.toBeVisible();
  await expect(page.getByAltText('学校校徽')).toBeVisible();

  await page.getByRole('button', { name: /^工作经历(?: |$)/ }).click();
  await page.getByRole('button', { name: '新增一条工作经历' }).click();
  await page.getByRole('button', { name: '新增一条工作经历' }).click();
  await page.getByLabel('公司').nth(0).fill('甲公司');
  await page.getByLabel('公司').nth(1).fill('乙公司');
  await page.getByLabel('角色/职位').nth(0).fill('前端实习生');
  await page.getByLabel('角色/职位').nth(1).fill('前端实习生');
  await page.getByRole('spinbutton', { name: '与上一条记录间距' }).fill('12');
  await page.getByRole('spinbutton', { name: '与上一条记录间距' }).blur();

  await page.getByRole('button', { name: '排版设置' }).click();
  await page.getByRole('combobox', { name: '基本信息布局' }).click();
  await page.getByRole('option', { name: '右侧对齐' }).click();
  await page.getByRole('combobox', { name: '字体' }).click();
  await page.getByRole('option', { name: '思源宋体' }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect
    .poll(async () => visibleCanvasPreview(page).getAttribute('data-preview-key'), {
      timeout: 30_000,
    })
    .not.toBe(sansPreviewKey);

  const serifDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF' }).click();
  await (
    await serifDownloadPromise
  ).saveAs(testInfo.outputPath('local-resume-right-custom-spacing.pdf'));

  await page.getByRole('button', { name: /^个人简介(?: |$)/ }).click();
  await page
    .getByRole('textbox', { name: '简介内容' })
    .fill(
      Array.from(
        { length: 90 },
        (_, index) => `- 第 ${index + 1} 项：用于验证本地简历 Canvas 多页预览的长内容。`,
      ).join('\n'),
    );
  await expect
    .poll(async () => visibleCanvasPreview(page).locator('canvas').count(), { timeout: 30_000 })
    .toBeGreaterThan(1);
  const lastCanvas = visibleCanvasPreview(page).locator('canvas').last();
  await lastCanvas.scrollIntoViewIfNeeded();
  await expect(lastCanvas).toHaveAttribute('data-rendered', 'true', { timeout: 30_000 });
  expect(resumeApiRequests).toHaveLength(0);
});

test('local console blocks instead of creating a temporary session when IndexedDB is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('blocked for test', 'InvalidStateError');
      },
    });
  });

  await page.goto('/local');

  await expect(page.getByRole('heading', { name: '无法打开本地简历' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重试连接' })).toBeVisible();
  await expect(page.getByRole('button', { name: '清除本地数据' })).toBeVisible();
  await expect(page.getByRole('button', { name: '创建新简历' })).toHaveCount(0);
});

test('local console creates, renames, copies, searches and deletes resumes', async ({ page }) => {
  const resumeApiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/resumes')) resumeApiRequests.push(request.url());
  });

  await page.goto('/local');
  await page.getByRole('button', { name: '创建新简历' }).click();
  await page.getByLabel('简历标题').fill('本地流程简历');
  await expect(page.getByText('已保存到本机')).toBeVisible();
  await page.getByRole('button', { name: '返回本地控制台' }).click();

  await expect(page.getByRole('heading', { name: '本地流程简历' })).toBeVisible();
  await page.getByRole('button', { name: '本地流程简历 更多操作' }).click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  await page.getByLabel('简历名称').fill('前端主简历');
  await page.getByRole('button', { name: '保存名称' }).click();
  await expect(page.getByRole('heading', { name: '前端主简历' })).toBeVisible();

  await page.getByRole('button', { name: '前端主简历 更多操作' }).click();
  await page.getByRole('menuitem', { name: '复制简历' }).click();
  await expect(page.getByRole('heading', { name: '前端主简历 - 副本' })).toBeVisible();

  await page.getByLabel('搜索简历').fill('副本');
  await expect(page.getByRole('heading', { name: '前端主简历 - 副本' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '前端主简历', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '删除' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('heading', { name: '前端主简历 - 副本' })).toHaveCount(0);
  expect(resumeApiRequests).toHaveLength(0);
});

test('editor freezes the current draft after a storage failure and recovers on retry', async ({
  page,
}) => {
  await page.goto('/local');
  await page.getByRole('button', { name: '创建新简历' }).click();
  await expect(page.getByText('已保存到本机')).toBeVisible();

  await page.evaluate(() => {
    const testWindow = window as typeof window & { __testIndexedDB?: IDBFactory };
    testWindow.__testIndexedDB = window.indexedDB;
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('blocked for test', 'InvalidStateError');
      },
    });
  });
  await page.getByLabel('简历标题').fill('尚未落盘的本地简历');

  await expect(page.getByRole('alert')).toContainText('编辑已冻结');
  await expect(page.getByLabel('简历标题')).toBeDisabled();
  await expect(page.getByLabel('简历标题')).toHaveValue('尚未落盘的本地简历');
  await expect(page.getByRole('button', { name: '导出 PDF' })).toBeEnabled();

  await page.evaluate(() => {
    const testWindow = window as typeof window & { __testIndexedDB?: IDBFactory };
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: testWindow.__testIndexedDB,
      writable: true,
    });
  });
  await page.getByRole('button', { name: '重试保存' }).click();

  await expect(page.getByText('已保存到本机')).toBeVisible();
  await expect(page.getByLabel('简历标题')).toBeEnabled();
});

test.describe('mobile local PDF canvas', () => {
  test.use({
    deviceScaleFactor: devices['Pixel 7'].deviceScaleFactor,
    hasTouch: devices['Pixel 7'].hasTouch,
    isMobile: devices['Pixel 7'].isMobile,
    userAgent: devices['Pixel 7'].userAgent,
    viewport: devices['Pixel 7'].viewport,
  });

  test('renders PDF pixels without an Android browser placeholder', async ({ page }) => {
    await page.goto('/local');
    await page.getByRole('button', { name: '创建新简历' }).click();
    await page.getByLabel('姓名').fill('移动端测试');

    const preview = visibleCanvasPreview(page);
    const firstCanvas = preview.getByRole('img', { name: 'PDF 第 1 页预览' });
    await expect(firstCanvas).toHaveAttribute('data-rendered', 'true', { timeout: 30_000 });
    await expect.poll(() => canvasHasInk(firstCanvas)).toBe(true);
    await expect(page.locator('iframe, object, embed')).toHaveCount(0);
    await expect(page.getByText('打开', { exact: true })).toHaveCount(0);
  });
});

function visibleCanvasPreview(page: Page) {
  return page.locator('[data-testid="local-pdf-canvas-preview"]:visible');
}

async function canvasHasInk(canvas: Locator) {
  return canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext('2d');
    if (!context || !target.width || !target.height) return false;
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    for (let index = 0; index < pixels.length; index += 32) {
      if (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235) return true;
    }
    return false;
  });
}
