// Writes the published Event Hub contract files (EVT-01): docs/event-hub/schema.v1.json and one example per
// message type in docs/event-hub/examples/. Run `npm run contract:event-hub` after changing the schemas.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractJsonSchema } from '../src/eventhub/contract.js';
import { EXAMPLE_MESSAGES } from '../src/eventhub/fixtures.js';

export function contractFiles(): Record<string, string> {
  const files: Record<string, string> = { 'schema.v1.json': `${JSON.stringify(contractJsonSchema(), null, 2)}\n` };
  for (const message of EXAMPLE_MESSAGES) files[`examples/${message.type}.json`] = `${JSON.stringify(message, null, 2)}\n`;
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'event-hub');
  for (const [name, content] of Object.entries(contractFiles())) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  console.log(`Wrote ${Object.keys(contractFiles()).length} files to ${root}`);
}
