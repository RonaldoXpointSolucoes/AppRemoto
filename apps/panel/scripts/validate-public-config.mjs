import { parsePublicConfig } from '../src/lib/config.ts';

try {
  parsePublicConfig(process.env);
  process.stdout.write('Panel public build configuration is valid.\n');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Invalid public configuration';
  process.stderr.write(`${message.replace(/^Invalid public configuration: /, '')}\n`);
  process.exitCode = 1;
}
