import { expect, test } from '@playwright/test';

test('anonymous analytics requires consent, persists choice, records milestones and deletes on withdrawal', async ({
  page,
}) => {
  const events: Array<Record<string, string>> = [];
  const deletions: Array<Record<string, string>> = [];

  await page.route('**/api/analytics/config', (route) =>
    route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({ enabled: true, consentVersion: '1' }),
    }),
  );
  await page.route('**/api/analytics/events', async (route) => {
    events.push(route.request().postDataJSON() as Record<string, string>);
    await route.fulfill({ status: 202 });
  });
  await page.route('**/api/analytics/deletions', async (route) => {
    deletions.push(route.request().postDataJSON() as Record<string, string>);
    await route.fulfill({ status: 202 });
  });

  await page.goto('/local');
  const prompt = page.getByRole('dialog', { name: '匿名使用统计' });
  await expect(prompt).toBeVisible();
  expect(events).toHaveLength(0);

  await prompt.getByRole('button', { name: '暂不参与' }).click();
  await expect(prompt).not.toBeVisible();
  await page.reload();
  await expect(prompt).not.toBeVisible();
  expect(events).toHaveLength(0);

  await page.getByRole('button', { name: '隐私设置' }).click();
  const settings = page.getByRole('dialog', { name: '匿名统计设置' });
  await settings.getByRole('button', { name: '同意匿名统计' }).click();
  await expect(settings).not.toBeVisible();
  await expect
    .poll(() => events.some((event) => event.eventName === 'workspace_activated'))
    .toBe(true);

  await page.getByRole('button', { name: '创建新简历' }).click();
  await expect(page).toHaveURL(/\/local\/resumes\/[^/]+\/edit$/);
  await expect.poll(() => events.some((event) => event.eventName === 'resume_created')).toBe(true);

  await page.getByRole('button', { name: /仅存此浏览器/ }).click();
  await page.getByRole('menuitem', { name: '隐私设置' }).click();
  await settings.getByRole('button', { name: '退出匿名统计' }).click();
  await expect.poll(() => deletions).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(settings).not.toBeVisible();

  const eventCountAfterWithdrawal = events.length;
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /JSON/ }).click();
  await page.getByRole('menuitem', { name: '导出 JSON' }).click();
  await downloadPromise;
  await page.waitForTimeout(100);
  expect(events).toHaveLength(eventCountAfterWithdrawal);
});
