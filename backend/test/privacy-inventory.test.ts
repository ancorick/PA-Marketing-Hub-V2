import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { consentRecords, contacts, deliveries, eventRegistrations, linkClicks, suppressions, touchpoints } from '../src/db/schema.js';

const TABLES = { contacts, consentRecords, suppressions, touchpoints, deliveries, linkClicks, eventRegistrations };
const AUDIT_COLUMNS = new Set(['createdAt', 'updatedAt']);

describe('personal data inventory (NFR-P2)', () => {
  it('lists every column of the tables that hold people, with a purpose', () => {
    const doc = readFileSync(join(import.meta.dirname, '..', 'docs', 'data-inventory.md'), 'utf8');
    const missing: string[] = [];
    for (const [name, table] of Object.entries(TABLES)) {
      const section = doc.split(`## ${name}`)[1]?.split('\n## ')[0];
      if (!section) {
        missing.push(`${name} (no section)`);
        continue;
      }
      const listed = new Set([...section.matchAll(/^\| ([^|]+) \|/gm)].flatMap((match) => match[1]!.split(',').map((column) => column.trim())));
      for (const column of Object.keys(getTableColumns(table))) if (!AUDIT_COLUMNS.has(column) && !listed.has(column)) missing.push(`${name}.${column}`);
    }
    expect(missing).toEqual([]);
  });
});
