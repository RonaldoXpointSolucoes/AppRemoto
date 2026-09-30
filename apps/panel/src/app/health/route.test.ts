import { expect, it } from 'vitest';

it('returns the public deployment health contract without accessing authentication', async () => {
  const { GET } = await import('./route');
  const response = GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
