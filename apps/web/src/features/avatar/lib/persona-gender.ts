/**
 * Which 3D body a persona gets — `male` or `female` suit.
 *
 * The contract field `Persona.gender` is authoritative, but it is optional and
 * most existing rows predate it, so the stage must still pick a body for a
 * persona that only has a name and a voice. The fallbacks are ordered by how
 * much they actually say about presentation: an honorific in the name is a
 * deliberate authoring choice, a gendered TTS voice id is the next strongest
 * signal, and `female` is the last-resort default only because a default is
 * required — not because it is more likely.
 *
 * `other` (a committee, a company, an unspecified persona) has no third body,
 * so it falls through to the same heuristics rather than a hard-coded model.
 */
import type { Persona, PersonaGender } from '@ai-coach/shared';

/** The two bodies the archive ships. */
export type AvatarBodyGender = 'male' | 'female';

/** Enough of `Persona` to decide; the bootstrap view model satisfies it too. */
export interface GenderSource {
  name?: string | null;
  gender?: PersonaGender | null;
  voice?: { voice_id?: string | null } | null;
}

/** Mr / 先生 (also 老爺, 公子 are rare in personas — not matched on purpose). */
const MALE_NAME = /(先生|\bMr\.?(?=\s|$))/i;
/** 小姐 / 太太 / 女士 / Ms / Mrs / Miss. */
const FEMALE_NAME = /(小姐|太太|女士|\bMs\.?(?=\s|$)|\bMrs\.?(?=\s|$)|\bMiss(?=\s|$))/i;

export function genderFromName(name: string | null | undefined): AvatarBodyGender | null {
  if (!name) return null;
  // Female first: "Mrs" contains no "Mr" as a whole word, but 太太 / 小姐 are
  // never ambiguous and take priority over an English "Mr" that may appear in a
  // romanised suffix such as "(Mr. Chen)" after "陳太太".
  if (FEMALE_NAME.test(name)) return 'female';
  if (MALE_NAME.test(name)) return 'male';
  return null;
}

export function genderFromVoiceId(voiceId: string | null | undefined): AvatarBodyGender | null {
  if (!voiceId) return null;
  const id = voiceId.toLowerCase();
  // "female" contains "male", so it must be checked first.
  if (id.includes('female')) return 'female';
  if (id.includes('male')) return 'male';
  return null;
}

/**
 * Resolve the avatar body for a persona.
 *
 * Order: explicit `gender` (male / female) → name honorific → voice id → female.
 * Accepts a full `Persona`, or any object carrying a subset of those fields.
 */
export function resolvePersonaGender(
  persona: GenderSource | Persona | null | undefined,
): AvatarBodyGender {
  if (!persona) return 'female';
  if (persona.gender === 'male' || persona.gender === 'female') return persona.gender;
  return (
    genderFromName(persona.name) ??
    genderFromVoiceId(persona.voice?.voice_id) ??
    'female'
  );
}
