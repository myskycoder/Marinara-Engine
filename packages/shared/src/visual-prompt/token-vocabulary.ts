/** Flux natural-language phrase for a visual token slug. */
export const FLUX_TOKEN_PHRASES: Record<string, string> = {
  first_person: "first-person POV",
  intimate_distance: "intimate close distance",
  "35mm": "35mm lens",
  shallow_dof: "shallow depth of field",
  deep_dof: "deep depth of field",
  tight_medium: "tight medium shot",
  tight_medium_framing: "tight medium framing",
  slight_downward: "slightly downward angle",
  standing_eye_level: "standing eye level",
  red_hair: "red-haired woman",
  long_red_hair: "long red hair",
  black_cocktail_dress: "black cocktail dress",
  black_dress: "black dress",
  black_dress_hiked_up: "black dress hiked to waist",
  dress_hiked_to_waist: "dress hiked to waist",
  displaced_lace_panties: "lace panties pushed aside",
  displaced_lace_lingerie: "lace lingerie pushed aside",
  black_high_heels: "black high heels",
  bare_legs: "bare legs",
  bent_over_sink: "bent over white marble vanity",
  bent_over_marble_counter: "bent over marble counter",
  pressed_against_marble_counter: "pressed against marble counter",
  arched_back: "arched back",
  hands_on_sink_rim: "hands gripping sink edge",
  hands_gripping_sink_edge: "hands gripping sink edge",
  hands_gripping_counter_edge: "white-knuckled fingers gripping counter edge",
  head_thrown_back: "head thrown back",
  knees_spread: "knees spread",
  legs_spread_wide: "legs spread wide",
  rear_penetration: "penetrated from behind",
  deep_rhythm: "deep rhythm",
  player_hands_on_hips: "player hands gripping hips at frame edge",
  mirror_face_centered: "mirror reflection centered",
  mirror_face_reflection: "mirror face reflection",
  face_mirror_only: "face visible only through mirror reflection",
  hips_foreground: "hips as foreground focal point",
  hips_pressed_marble: "hips pressed against marble",
  wet_skin: "wet skin sheen",
  wet_skin_sheen: "wet skin sheen",
  polished_marble: "cold polished marble",
  cold_polished_marble: "cold polished marble",
  lace_lingerie: "lace lingerie",
  glossy_tile: "glossy black tile floor",
  black_glossy_tile_floor: "black glossy tile floor",
  gold_fixtures: "gold fixtures",
  luxury_bathroom: "narrow luxury bathroom",
  white_marble: "white marble vanity",
  white_marble_surfaces: "white marble surfaces",
  mirror_reflection: "large wall mirror opposite",
  no_player_body: "no protagonist body visible",
  hands_at_frame_edge_only: "only player hands at bottom edge of frame",
  flushed_face: "flushed face",
  tear_streaks: "tear streaks on cheeks",
  tears_on_cheeks: "tears on cheeks",
  open_mouth: "open mouth",
  open_mouth_moan: "open mouth moaning",
  gasping: "gasping expression",
  biting_lip: "biting lip",
  half_lidded_eyes: "half-lidded eyes",
  eyes_rolled_back: "eyes rolled back",
  blushing: "blushing cheeks",
  drooling: "drooling",
};

/** Danbooru-style tags for Illustrious / Pony adapters. */
export const BOORU_TOKEN_TAGS: Record<string, string> = {
  red_hair: "red_hair",
  long_red_hair: "long_hair",
  black_cocktail_dress: "black_dress",
  black_dress: "black_dress",
  dress_hiked_to_waist: "dress_lift",
  displaced_lace_panties: "panties_aside",
  bent_over_sink: "bent_over",
  bent_over_marble_counter: "bent_over",
  pressed_against_marble_counter: "bent_over",
  arched_back: "arched_back",
  hands_on_sink_rim: "gripping",
  hands_gripping_sink_edge: "gripping",
  rear_penetration: "sex",
  deep_rhythm: "deep_penetration",
  player_hands_on_hips: "hands_on_hips",
  from_behind: "from_behind",
  first_person: "pov",
  mirror_face_centered: "mirror",
  face_mirror_only: "reflection",
  wet_skin: "wet_skin",
  polished_marble: "marble",
  glossy_tile: "tile_floor",
  gold_fixtures: "indoors",
  luxury_bathroom: "bathroom",
  head_thrown_back: "head_back",
  knees_spread: "spread_legs",
  legs_spread_wide: "spread_legs",
  flushed_face: "blush",
  tear_streaks: "tears",
  open_mouth: "open_mouth",
};

/** Known slug synonyms → canonical vocabulary key. */
export const TOKEN_SYNONYMS: Record<string, string> = {
  pressed_against_marble_counter: "bent_over_marble_counter",
  legs_spread_wide: "knees_spread",
  displaced_lace_lingerie: "displaced_lace_panties",
  hands_gripping_sink_edge: "hands_on_sink_rim",
  hips_pressed_marble: "hips_foreground",
  tight_medium_framing: "tight_medium",
  cold_polished_marble: "polished_marble",
  wet_skin_sheen: "wet_skin",
  mirror_face_reflection: "mirror_face_centered",
  gripping_hands_sink_edge: "hands_on_sink_rim",
  pressed_hips_marble: "hips_foreground",
  shallow: "shallow_dof",
  deep: "deep_dof",
  intimate: "intimate_distance",
};

export function normalizeTokenSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase().replace(/\s+/g, "_");
  return TOKEN_SYNONYMS[normalized] ?? normalized;
}

export function isKnownFluxToken(slug: string): boolean {
  return normalizeTokenSlug(slug) in FLUX_TOKEN_PHRASES;
}

export function isKnownBooruToken(slug: string): boolean {
  const normalized = normalizeTokenSlug(slug);
  return normalized in BOORU_TOKEN_TAGS || normalized in FLUX_TOKEN_PHRASES;
}

export function fluxPhraseForToken(slug: string): string {
  const normalized = normalizeTokenSlug(slug);
  return FLUX_TOKEN_PHRASES[normalized] ?? slug.replace(/_/g, " ");
}

export function booruTagForToken(slug: string): string {
  const normalized = normalizeTokenSlug(slug);
  return BOORU_TOKEN_TAGS[normalized] ?? normalized;
}

export function fluxPhrasesForTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const phrase = fluxPhraseForToken(token);
    const key = phrase.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(phrase);
    }
  }
  return out;
}

export function booruTagsForTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const tag = booruTagForToken(token);
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** Top vocabulary slugs grouped for LLM closed-vocabulary instructions. */
export function fluxAllowedTokenSlugsByCategory(): Record<string, string[]> {
  return {
    subject: [
      "red_hair",
      "black_cocktail_dress",
      "black_dress_hiked_up",
      "displaced_lace_panties",
      "black_high_heels",
      "bare_legs",
    ],
    pose: ["bent_over_marble_counter", "arched_back", "hands_on_sink_rim", "legs_spread_wide", "head_thrown_back"],
    interaction: ["rear_penetration", "deep_rhythm", "player_hands_on_hips"],
    composition: ["mirror_face_centered", "face_mirror_only", "hips_foreground"],
    expression: ["flushed_face", "tear_streaks", "open_mouth", "head_thrown_back", "gasping", "biting_lip"],
    material: ["wet_skin", "polished_marble", "lace_lingerie"],
    camera: ["first_person", "intimate_distance", "35mm", "shallow_dof", "tight_medium"],
    environment: ["luxury_bathroom", "white_marble", "gold_fixtures", "glossy_tile"],
  };
}
