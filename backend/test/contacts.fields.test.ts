import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizePhone, normalizeTags } from '../src/contacts/fields.js';

describe('contact field normalization (AUD-02, PRD 12.4)', () => {
  it('lower-cases and trims emails but keeps dots and plus tags as entered', () => {
    expect(normalizeEmail('  Anna.P+news@Gmail.COM ')).toBe('anna.p+news@gmail.com');
    for (const bad of ['anna', 'anna@', '@example.test', 'an na@example.test', 'a@b']) {
      expect(() => normalizeEmail(bad), bad).toThrow();
    }
  });

  it('keeps phone digits with the country code', () => {
    expect(normalizePhone('00374 91 234567')).toBe('+37491234567');
    expect(normalizePhone('  ')).toBeNull();
    expect(() => normalizePhone('+0 12')).toThrow();
  });

  it('cleans tags in any script and caps their number', () => {
    expect(normalizeTags([' #Open Day ', 'open-day', 'Ալումնի', 'выпускник'])).toEqual(['open-day', 'ալումնի', 'выпускник']);
    expect(() => normalizeTags(Array.from({ length: 21 }, (_, i) => `t${i}`))).toThrow(/at most 20/);
  });
});
