/**
 * Which body a persona gets, and how it should be worn.
 *
 * Six Microsoft Rocketbox characters — two base rigs × three ages — copied from
 * the reference viewer's roster (`CHARACTERS` in its `public/index.html`). The
 * ages are **not** three separate scans: each gender is one FBX whose face and
 * hair textures were re-baked per age by that project's `tools/rocketbox_age.py`
 * (wrinkles from an ageing GAN, grey hair from a luminance mask) and then packed
 * into a VRM 1.0 by `tools/vrm_finalize.py`. So the mesh is shared and only the
 * skin tells the age apart — which is why the runtime still has to carry the
 * posture and skin-tone half of the look.
 *
 * The numbers in `AVATAR_LOOK` are that roster's, verbatim:
 *
 *   m30 王先生・30・業務   skin  0     stoop 0     speed 1.00
 *   m50 王先生・50         skin -0.02  stoop 0.12  speed 0.90
 *   m65 王先生・65・退休   skin -0.04  stoop 0.30  speed 0.74
 *   f30 李小姐・30・上班族 skin  0     stoop 0     speed 1.00
 *   f40 李女士・40・主管   skin -0.01  stoop 0.07  speed 0.95
 *   f65 李女士・65・退休   skin -0.04  stoop 0.26  speed 0.76
 *
 * Its fourth slider, `gray` (髮色白化), is 0 for all six and is not ported: the
 * white hair is already baked into the aged textures, and the slider existed to
 * re-draw a texture on canvas for models that have no aged variant.
 */
import type { AvatarBodyGender } from './persona-gender';

export type AvatarAgeBand = 'young' | 'middle' | 'senior';

/**
 * The same two thresholds the voice picks its speaker with
 * (`features/simulation/lib/system-speech.ts`, `app/ws/voice_catalog.py`), so a
 * persona cannot end up with a 65-year-old's face and a young voice.
 */
export const AVATAR_YOUNG_MAX_AGE = 35;
export const AVATAR_SENIOR_MIN_AGE = 65;

export function avatarAgeBand(age: number | null | undefined): AvatarAgeBand {
  if (age == null) return 'middle';
  if (age >= AVATAR_SENIOR_MIN_AGE) return 'senior';
  return age < AVATAR_YOUNG_MAX_AGE ? 'young' : 'middle';
}

export interface AvatarLook {
  /** Lightness offset on the skin material (`offsetHSL(0, 0, skin)`). */
  skin: number;
  /** Stoop, in radians, shared across spine/chest/upperChest/neck. */
  stoop: number;
  /** Motion playback rate. Kept for parity; this stage plays no motion clips. */
  speed: number;
}

const LOOK: Record<`${AvatarBodyGender}:${AvatarAgeBand}`, AvatarLook> = {
  'male:young': { skin: 0, stoop: 0, speed: 1.0 },
  'male:middle': { skin: -0.02, stoop: 0.12, speed: 0.9 },
  'male:senior': { skin: -0.04, stoop: 0.3, speed: 0.74 },
  'female:young': { skin: 0, stoop: 0, speed: 1.0 },
  'female:middle': { skin: -0.01, stoop: 0.07, speed: 0.95 },
  'female:senior': { skin: -0.04, stoop: 0.26, speed: 0.76 },
};

export function avatarLook(gender: AvatarBodyGender, age: number | null | undefined): AvatarLook {
  return LOOK[`${gender}:${avatarAgeBand(age)}`];
}

/** `/models/avatar_<gender>_<band>.vrm` — all six ship in `public/models`. */
export function modelUrlFor(gender: AvatarBodyGender, age?: number | null): string {
  return `/models/avatar_${gender}_${avatarAgeBand(age)}.vrm`;
}

/**
 * Material roles, by name, from the viewer's `matRole()`.
 *
 * Rocketbox splits a character into `*_head` (face and neck skin), `*_body`
 * (skin *and* the suit, so it must never be tinted — the jacket would tint with
 * it) and `*_opacity` (the alpha-cut hair and eyelash cards).
 */
export function materialRole(name: string): 'skin' | 'hair' | 'brow' | null {
  if (/_HAIR|avaturn_hair|_opacity$/i.test(name)) return 'hair';
  if (/FaceBrow|Eyelash/i.test(name)) return 'brow';
  if (/_SKIN|_head$|^Body$|^Head$/i.test(name)) return 'skin';
  return null;
}
