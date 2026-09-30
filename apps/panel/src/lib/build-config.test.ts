import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const panelRoot = fileURLToPath(new URL('../..', import.meta.url));
const validator = fileURLToPath(new URL('../../scripts/validate-public-config.mjs', import.meta.url));
const validEnvironment = {
  NEXT_PUBLIC_APPWRITE_ENDPOINT: 'https://appwrite.example.com/v1',
  NEXT_PUBLIC_APPWRITE_PROJECT_ID: 'remote-project',
  NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com',
};

function runValidator(environment: Record<string, string | undefined>) {
  const cleanEnvironment = { ...process.env };
  for (const key of Object.keys(validEnvironment)) delete cleanEnvironment[key];
  return spawnSync(process.execPath, [validator], {
    cwd: panelRoot,
    encoding: 'utf8',
    env: { ...cleanEnvironment, ...environment },
  });
}

describe('panel build configuration gate', () => {
  it('fails before the Next build when a required public build variable is absent', () => {
    const result = runValidator({
      ...validEnvironment,
      NEXT_PUBLIC_API_BASE_URL: undefined,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NEXT_PUBLIC_API_BASE_URL is required');
  });

  it('fails before the Next build when a public build variable is invalid', () => {
    const result = runValidator({
      ...validEnvironment,
      NEXT_PUBLIC_APPWRITE_ENDPOINT: 'http://appwrite.example.com/v1',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NEXT_PUBLIC_APPWRITE_ENDPOINT must be an absolute HTTPS URL');
  });
});
