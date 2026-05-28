import assert from "node:assert/strict";
import test from "node:test";
import { buildFluxStaticStyleBlock } from "../src/services/game/flux-static-style.js";

test("buildFluxStaticStyleBlock filters nightclub tokens when environment is bathroom", () => {
  const result = buildFluxStaticStyleBlock(
    {
      artStyle: "Glossy anime hentai style, vibrant nightclub palette of purple, pink and gold",
      genre: "Romance, nightclub, bartender, harem, seduction",
      setting: "Nightclub",
    },
    ["luxury_bathroom", "white_marble_surfaces"],
  );

  assert.doesNotMatch(result.block, /nightclub setting/i);
  assert.doesNotMatch(result.block, /bartender/i);
  assert.doesNotMatch(result.block, /party scene/i);
  assert.doesNotMatch(result.block, /nightclub palette/i);
  assert.doesNotMatch(result.block, /\bharem\b/i);
  assert.doesNotMatch(result.block, /\bromance\b/i);
  assert.doesNotMatch(result.block, /\bseduction\b/i);
  assert.ok(result.filteredOut.length >= 1);
});

test("buildFluxStaticStyleBlock keeps nightclub tokens without bathroom environment", () => {
  const result = buildFluxStaticStyleBlock(
    { genre: "nightclub", setting: "party" },
    [],
  );
  assert.match(result.block, /nightclub setting/i);
});
