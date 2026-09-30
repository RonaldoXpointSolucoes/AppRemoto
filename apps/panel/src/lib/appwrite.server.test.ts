import { expect, it } from 'vitest';

it('rejects importing the Appwrite Web SDK wrapper from a Server Component', async () => {
  await expect(import('./appwrite')).rejects.toThrow(
    'This module cannot be imported from a Server Component module.',
  );
});
