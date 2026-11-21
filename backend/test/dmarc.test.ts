import type { FastifyInstance } from 'fastify';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categorize, inKnownSources, parseDmarcReport } from '../src/dmarc/service.js';
import { bearer, buildTestApp, testConfig } from './helpers.js';

const report = (reportId: string, records: { ip: string; count: number; dkim: string; spf: string }[]) => `<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata><org_name>google.com</org_name><email>noreply-dmarc-support@google.com</email><report_id>${reportId}</report_id>
    <date_range><begin>${Math.floor(Date.now() / 1000) - 86400}</begin><end>${Math.floor(Date.now() / 1000)}</end></date_range></report_metadata>
  <policy_published><domain>news.academy.example</domain><adkim>r</adkim><aspf>r</aspf><p>none</p><pct>100</pct></policy_published>
  ${records
    .map(
      (r) => `<record><row><source_ip>${r.ip}</source_ip><count>${r.count}</count><policy_evaluated><disposition>none</disposition><dkim>${r.dkim}</dkim><spf>${r.spf}</spf></policy_evaluated></row>
    <identifiers><header_from>news.academy.example</header_from></identifiers><auth_results><dkim><domain>news.academy.example</domain><result>${r.dkim}</result></dkim></auth_results></record>`,
    )
    .join('\n')}
</feedback>`;

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp({ config: testConfig({ DMARC_KNOWN_SOURCES: '198.51.100.0/24' }) });
});
afterEach(() => app.close());

const upload = (body: Buffer | string, role = 'admin') =>
  app.inject({ method: 'POST', url: '/api/email/dmarc-reports', headers: { ...bearer(role), 'content-type': 'application/xml' }, payload: body });

describe('DMARC aggregate reports (EML-07)', () => {
  it('parses a report and classifies sources as pass, fail (known sender) or unknown', () => {
    const parsed = parseDmarcReport(Buffer.from(report('r1', [{ ip: '203.0.113.5', count: 3, dkim: 'pass', spf: 'fail' }])));
    expect(parsed).toMatchObject({ orgName: 'google.com', reportId: 'r1', domain: 'news.academy.example', policy: 'none', records: [{ sourceIp: '203.0.113.5', count: 3, dkim: 'pass' }] });
    expect(inKnownSources('198.51.100.77', ['198.51.100.0/24'])).toBe(true);
    expect(inKnownSources('198.51.101.1', ['198.51.100.0/24'])).toBe(false);
    expect(categorize({ sourceIp: '198.51.100.9', dkim: 'fail', spf: 'fail' }, ['198.51.100.0/24'])).toBe('fail');
    expect(categorize({ sourceIp: '192.0.2.1', dkim: 'fail', spf: 'fail' }, ['198.51.100.0/24'])).toBe('unknown');
  });

  it('stores uploads once, shows the pass rate (M6) and alerts the admin about unknown sources', async () => {
    const xml = report('r2', [
      { ip: '198.51.100.10', count: 95, dkim: 'pass', spf: 'pass' },
      { ip: '198.51.100.11', count: 3, dkim: 'fail', spf: 'fail' },
      { ip: '192.0.2.66', count: 2, dkim: 'fail', spf: 'fail' },
    ]);
    expect((await upload(xml, 'marketing_manager')).statusCode).toBe(403);
    const first = await upload(gzipSync(xml));
    expect(first.json()).toMatchObject({ duplicate: false, records: 3, unknownSources: ['192.0.2.66'] });
    expect((await upload(xml)).json()).toMatchObject({ duplicate: true });

    const summary = (await app.inject({ method: 'GET', url: '/api/email/dmarc-reports/summary', headers: bearer('marketing_manager') })).json();
    expect(summary).toMatchObject({ reports: 1, messages: 100, totals: { pass: 95, fail: 3, unknown: 2 }, passRate: 0.95 });
    expect(summary.sources[0]).toMatchObject({ sourceIp: '198.51.100.10', category: 'pass', messages: 95, reporters: ['google.com'] });

    const alerts = (await app.inject({ method: 'GET', url: '/api/alerts', headers: bearer('admin') })).json().alerts;
    expect(alerts[0]).toMatchObject({ title: 'DMARC failures from an unknown source', message: expect.stringContaining('192.0.2.66') });
  });

  it('rejects files that are not DMARC reports, and does not expand XML entities', async () => {
    expect((await upload('<html></html>')).json()).toMatchObject({ error: 'invalid_report' });
    expect((await upload(Buffer.from([0x50, 0x4b, 3, 4]))).json().message).toMatch(/Zip/);
    const bomb = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>${report('r3', [{ ip: '192.0.2.1', count: 1, dkim: 'pass', spf: 'pass' }]).replace('<?xml version="1.0" encoding="UTF-8" ?>', '').replace('google.com</org_name>', '&b;</org_name>')}`;
    const response = await upload(bomb);
    expect(response.statusCode).toBe(201);
  });
});
