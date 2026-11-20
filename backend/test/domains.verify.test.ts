import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { expectedRecords } from '../src/domains/records.js';
import type { EspDomainIdentity } from '../src/domains/types.js';
import { checkDomainRecords, statusOf } from '../src/domains/verify.js';
import { FakeDns } from './helpers.js';

const DOMAIN = 'news.academy.example';

function rsaPublicKey(bits: number): string {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

const KEY_2048 = rsaPublicKey(2048);

/** A TXT-style DKIM ESP, so the key length check runs. */
const identity: EspDomainIdentity = {
  provider: 'test-esp',
  placeholder: false,
  spfInclude: 'spf.esp.example',
  dkim: [{ selector: 's1', type: 'TXT', value: `v=DKIM1; k=rsa; p=${KEY_2048}` }],
  trackingLabel: 'click',
  trackingTarget: 'track.esp.example',
};

const records = expectedRecords(DOMAIN, identity);

function publishAll(dns = new FakeDns()) {
  return dns
    .setTxt(DOMAIN, 'v=spf1 include:spf.esp.example -all', 'google-site-verification=abc')
    .setTxt('spf.esp.example', 'v=spf1 ip4:192.0.2.0/24 -all')
    .setTxt(`s1._domainkey.${DOMAIN}`, `v=DKIM1; k=rsa; p=${KEY_2048}`)
    .setTxt(`_dmarc.${DOMAIN}`, 'v=DMARC1; p=quarantine; rua=mailto:dmarc@academy.example')
    .setCname(`click.${DOMAIN}`, 'TRACK.esp.example.');
}

const check = (dns: FakeDns) => checkDomainRecords(dns, records, identity.spfInclude);
const problemsOf = async (dns: FakeDns, kind: string) =>
  (await check(dns)).records.filter((record) => record.kind === kind).flatMap((record) => record.problems);

describe('expected records (EML-02)', () => {
  it('lists SPF, DKIM, DMARC and the tracking CNAME with exact hosts and values', () => {
    expect(records.map(({ kind, type, host }) => `${kind} ${type} ${host}`)).toEqual([
      `spf TXT ${DOMAIN}`,
      `dkim TXT s1._domainkey.${DOMAIN}`,
      `dmarc TXT _dmarc.${DOMAIN}`,
      `tracking CNAME click.${DOMAIN}`,
    ]);
    expect(records[0]?.value).toBe('v=spf1 include:spf.esp.example -all');
    expect(records[2]?.value).toMatch(/^v=DMARC1; p=none; rua=mailto:dmarc-reports@news\.academy\.example/);
    expect(records.filter((record) => record.requiredForSending).map((record) => record.kind)).toEqual(['spf', 'dkim', 'dmarc']);
  });

  it('uses the configured DMARC report mailbox', () => {
    const [, , dmarc] = expectedRecords(DOMAIN, identity, { dmarcReportEmail: 'reports@academy.example' });
    expect(dmarc?.value).toContain('rua=mailto:reports@academy.example');
  });
});

describe('live DNS check (EML-02)', () => {
  it('verifies correctly published records and reads the DMARC policy', async () => {
    const result = await check(publishAll());
    expect(result.records.map((record) => [record.kind, record.status])).toEqual([
      ['spf', 'verified'],
      ['dkim', 'verified'],
      ['dmarc', 'verified'],
      ['tracking', 'verified'],
    ]);
    expect(result.dmarcPolicy).toBe('quarantine');
    // Only the SPF record is reported, not unrelated TXT records at the same host.
    expect(result.records[0]?.found).toEqual(['v=spf1 include:spf.esp.example -all']);
  });

  it('reports missing records when nothing is published', async () => {
    const result = await check(new FakeDns());
    expect(result.records.every((record) => record.status === 'missing')).toBe(true);
    expect(result.dmarcPolicy).toBeNull();
  });

  it('reports a DNS failure as an error, not as missing', async () => {
    const dns = publishAll();
    dns.failing.add(`_dmarc.${DOMAIN}`);
    const result = await check(dns);
    expect(statusOf(result, 'dmarc')).toBe('error');
    expect(statusOf(result, 'spf')).toBe('verified');
  });

  describe('SPF', () => {
    it('rejects two SPF records', async () => {
      const dns = publishAll().setTxt(DOMAIN, 'v=spf1 include:spf.esp.example -all', 'v=spf1 mx -all');
      expect(await problemsOf(dns, 'spf')).toEqual([expect.stringMatching(/More than one SPF record/)]);
    });

    it('requires the ESP include', async () => {
      const dns = publishAll().setTxt(DOMAIN, 'v=spf1 include:other.example -all');
      expect(await problemsOf(dns, 'spf')).toEqual([expect.stringMatching(/add include:spf\.esp\.example/)]);
    });

    it('rejects +all and a record without an all rule', async () => {
      expect(await problemsOf(publishAll().setTxt(DOMAIN, 'v=spf1 include:spf.esp.example +all'), 'spf')).toEqual([
        expect.stringMatching(/"\+all" lets any server send/),
      ]);
      expect(await problemsOf(publishAll().setTxt(DOMAIN, 'v=spf1 include:spf.esp.example'), 'spf')).toEqual([
        expect.stringMatching(/Must end with -all/),
      ]);
    });

    it('accepts redirect= to the ESP record instead of include:', async () => {
      const dns = publishAll().setTxt(DOMAIN, 'v=spf1 redirect=spf.esp.example');
      expect(await problemsOf(dns, 'spf')).toEqual([]);
    });

    it('requires the ESP include before the "all" rule, and ignores redirect= next to "all"', async () => {
      expect(await problemsOf(publishAll().setTxt(DOMAIN, 'v=spf1 -all include:spf.esp.example'), 'spf')).toEqual([
        expect.stringMatching(/before the "all" rule/),
      ]);
      expect(await problemsOf(publishAll().setTxt(DOMAIN, 'v=spf1 redirect=spf.esp.example -all'), 'spf')).toEqual([
        expect.stringMatching(/Does not authorize the email service/),
      ]);
    });

    it('accepts a soft fail (~all)', async () => {
      const dns = publishAll().setTxt(DOMAIN, 'v=spf1 include:spf.esp.example ~all');
      expect(await problemsOf(dns, 'spf')).toEqual([]);
    });

    it('fails a record that needs more than 10 DNS lookups, counting nested includes', async () => {
      const nested = Array.from({ length: 6 }, (_, i) => `include:n${i}.example`).join(' ');
      const dns = publishAll()
        .setTxt(DOMAIN, 'v=spf1 include:spf.esp.example include:big.example -all')
        .setTxt('big.example', `v=spf1 ${nested} a mx -all`);
      // 2 top-level + 6 nested includes + a + mx = 10 passes
      expect(await problemsOf(dns, 'spf')).toEqual([]);
      dns.setTxt('n0.example', 'v=spf1 a -all');
      expect(await problemsOf(dns, 'spf')).toEqual([expect.stringMatching(/more than 10 DNS lookups/)]);
    });
  });

  describe('DKIM', () => {
    it('fails a key shorter than 2048 bits', async () => {
      const weak = rsaPublicKey(1024);
      const weakIdentity = { ...identity, dkim: [{ selector: 's1', type: 'TXT' as const, value: `v=DKIM1; p=${weak}` }] };
      const dns = publishAll().setTxt(`s1._domainkey.${DOMAIN}`, `v=DKIM1; k=rsa; p=${weak}`);
      const result = await checkDomainRecords(dns, expectedRecords(DOMAIN, weakIdentity), identity.spfInclude);
      expect(result.records.find((record) => record.kind === 'dkim')?.problems).toEqual([
        'The DKIM key is 1024 bits; use a 2048-bit key',
      ]);
    });

    it('fails a key that differs from the ESP key', async () => {
      const dns = publishAll().setTxt(`s1._domainkey.${DOMAIN}`, `v=DKIM1; k=rsa; p=${rsaPublicKey(2048)}`);
      expect(await problemsOf(dns, 'dkim')).toEqual([expect.stringMatching(/differs from the one the email service signs with/)]);
    });

    it('checks CNAME-style DKIM by its target', async () => {
      const cnameIdentity = { ...identity, dkim: [{ selector: 's1', type: 'CNAME' as const, value: 's1.dkim.esp.example' }] };
      const cnameRecords = expectedRecords(DOMAIN, cnameIdentity);
      const dns = publishAll();
      dns.txt.delete(`s1._domainkey.${DOMAIN}`);
      dns.setCname(`s1._domainkey.${DOMAIN}`, 'wrong.esp.example');
      let result = await checkDomainRecords(dns, cnameRecords, identity.spfInclude);
      expect(statusOf(result, 'dkim')).toBe('invalid');
      dns.setCname(`s1._domainkey.${DOMAIN}`, 's1.dkim.esp.example');
      result = await checkDomainRecords(dns, cnameRecords, identity.spfInclude);
      expect(statusOf(result, 'dkim')).toBe('verified');
    });
  });

  describe('DMARC', () => {
    it('requires an aggregate report address', async () => {
      const dns = publishAll().setTxt(`_dmarc.${DOMAIN}`, 'v=DMARC1; p=none');
      expect(await problemsOf(dns, 'dmarc')).toEqual([expect.stringMatching(/Add rua=mailto/)]);
    });

    it('rejects an unknown policy', async () => {
      const dns = publishAll().setTxt(`_dmarc.${DOMAIN}`, 'v=DMARC1; p=monitor; rua=mailto:d@academy.example');
      const result = await check(dns);
      expect(statusOf(result, 'dmarc')).toBe('invalid');
      expect(result.dmarcPolicy).toBeNull();
    });
  });

  it('reports a tracking CNAME that points elsewhere', async () => {
    const dns = publishAll().setCname(`click.${DOMAIN}`, 'shared-tracking.example');
    expect(await problemsOf(dns, 'tracking')).toEqual([
      'Points to shared-tracking.example; must point to track.esp.example',
    ]);
  });
});
