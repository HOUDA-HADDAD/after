import { test, expect } from '@playwright/test';
import { signUp, api } from '../helpers/world.js';

test('three rooms retain independent codes through navigation, copy, regeneration and revocation', async ({
  browser,
}, testInfo) => {
  const owner = await signUp(browser, 'Hote');
  const guest = await signUp(browser, 'Invite');
  const rooms: { id: string; code: string; name: string }[] = [];
  try {
    await owner.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    for (const name of ['Salon A', 'Salon B', 'Salon C']) {
      await owner.page.goto('/');
      await owner.page.getByLabel('Nom de la salle', { exact: true }).fill(name);
      await owner.page.getByRole('button', { name: 'Créer', exact: true }).click();
      await expect(owner.page).toHaveURL(/\/groups\/[^/]+$/);
      await expect(owner.page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
      const response = await api(owner).get(
        `/api/v1/groups/${owner.page.url().split('/').at(-1)!}/invitations`,
      );
      const { invitations } = (await response.json()) as { invitations: { code: string }[] };
      expect(invitations).toHaveLength(1);
      const code = invitations[0]!.code;
      const id = owner.page.url().split('/').at(-1)!;
      await expect(
        owner.page.getByRole('button', { name: `Copier le code: ${code.split('').join(' ')}` }),
      ).toBeVisible();
      const joined = await api(guest).post('/api/v1/join', { data: { code } });
      expect(joined.status()).toBe(200);
      expect(await joined.json()).toMatchObject({ id });
      rooms.push({ id, code, name });
    }
    expect(new Set(rooms.map((room) => room.code)).size).toBe(3);
    const first = rooms[0]!;
    await owner.page.goto(`/groups/${first.id}`);
    const copy = owner.page.getByRole('button', { name: /^Copier le code:/ });
    await expect(copy).toContainText(first.code);
    await copy.click();
    expect(await owner.page.evaluate(() => navigator.clipboard.readText())).toBe(first.code);
    await owner.page.getByRole('button', { name: 'Générer un nouveau code' }).click();
    await expect(copy).not.toContainText(first.code);
    expect((await api(guest).post('/api/v1/join', { data: { code: first.code } })).status()).toBe(
      404,
    );
    await expect(owner.page.getByText('Code d’invitation actif', { exact: false })).toBeVisible();
    await owner.page.screenshot({ path: testInfo.outputPath('room.png'), fullPage: true });
    await owner.page.getByRole('button', { name: 'Révoquer le code' }).click();
    await expect(owner.page.getByText('Aucun code actif')).toBeVisible();
    await owner.page.getByRole('button', { name: 'Générer un nouveau code' }).click();
    await expect(copy).toBeVisible();
  } finally {
    await owner.context.close();
    await guest.context.close();
  }
});

test('one wrong password sends one network request and displays a French error', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel(/e-mail/i).fill('incorrect@example.com');
  await page.getByLabel(/^Mot de passe/i, { exact: false }).fill('incorrect');
  let attempts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/auth/login')) attempts++;
  });
  const response = page.waitForResponse((response) => response.url().endsWith('/auth/login'));
  await page.getByRole('button', { name: 'Se connecter' }).click();
  expect((await response).status()).toBe(401);
  await expect(page.getByText(/incorrect/i)).toBeVisible();
  expect(attempts).toBe(1);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});
