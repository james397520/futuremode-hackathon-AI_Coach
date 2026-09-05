import { describe, expect, it } from 'vitest';

import { genderFromName, genderFromVoiceId, resolvePersonaGender } from './persona-gender';

describe('resolvePersonaGender', () => {
  it('prefers the explicit contract field', () => {
    expect(resolvePersonaGender({ name: '陳先生', gender: 'female' })).toBe('female');
    expect(resolvePersonaGender({ name: '林小姐', gender: 'male' })).toBe('male');
  });

  it('falls through to heuristics for `other` and missing gender', () => {
    expect(resolvePersonaGender({ name: 'HR benefits committee (draft)', gender: 'other' })).toBe(
      'female',
    );
    expect(resolvePersonaGender({ name: '吳太太 (Mrs. Wu)', gender: 'other' })).toBe('female');
    expect(resolvePersonaGender({ name: '陳先生 (Mr. Chen)' })).toBe('male');
  });

  it('reads Chinese and English honorifics in the name', () => {
    expect(genderFromName('陳先生')).toBe('male');
    expect(genderFromName('Mr. Chen')).toBe('male');
    expect(genderFromName('Mr Chen')).toBe('male');
    expect(genderFromName('林小姐 (Bank walk-in)')).toBe('female');
    expect(genderFromName('吳太太')).toBe('female');
    expect(genderFromName('王女士')).toBe('female');
    expect(genderFromName('Ms. Lin')).toBe('female');
    expect(genderFromName('Mrs. Wu')).toBe('female');
    expect(genderFromName('Daniel Ko')).toBeNull();
    // "Mrs" must never match the male "Mr" rule.
    expect(genderFromName('Mrs Chen')).toBe('female');
  });

  it('uses the voice id when the name says nothing', () => {
    expect(genderFromVoiceId('zh-tw-male-mid')).toBe('male');
    expect(genderFromVoiceId('zh-tw-female-mature')).toBe('female');
    expect(genderFromVoiceId('en-FEMALE-brisk')).toBe('female');
    expect(genderFromVoiceId('alloy')).toBeNull();
    expect(
      resolvePersonaGender({ name: 'Daniel Ko', voice: { voice_id: 'en-male-brisk' } }),
    ).toBe('male');
  });

  it('defaults to female when nothing is known', () => {
    expect(resolvePersonaGender({ name: 'Daniel Ko' })).toBe('female');
    expect(resolvePersonaGender({ name: 'Daniel Ko', voice: { provider: 'none' } as never })).toBe(
      'female',
    );
    expect(resolvePersonaGender(null)).toBe('female');
    expect(resolvePersonaGender(undefined)).toBe('female');
  });
});
