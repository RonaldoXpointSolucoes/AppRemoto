import { parsePublicConfig } from '../src/lib/config.ts';

try {
  const config = parsePublicConfig(process.env);
  if (
    config.appwriteProjectId === '69db5246001f7f0ef0a9' ||
    config.appwriteEndpoint.includes('aogc088s00c4osck8k0ks0c4')
  ) {
    throw new Error(
      'Invalid public configuration: NEXT_PUBLIC_APPWRITE_PROJECT_ID / NEXT_PUBLIC_APPWRITE_ENDPOINT points to non-AppRemoto project'
    );
  }
  process.stdout.write('Panel public build configuration is valid.\n');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Invalid public configuration';
  process.stderr.write(`${message.replace(/^Invalid public configuration: /, '')}\n`);
  process.exitCode = 1;
}
