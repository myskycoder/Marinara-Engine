import test from "node:test";
import assert from "node:assert/strict";
import {
  GALLERY_ILLUSTRATION_STYLE_PRESETS,
  resolveGalleryIllustrationArtStyle,
} from "../../shared/dist/constants/gallery-illustration-styles.js";

test("resolveGalleryIllustrationArtStyle returns game prompt for game preset", () => {
  assert.equal(resolveGalleryIllustrationArtStyle("  dark fantasy oil painting  ", "game"), "dark fantasy oil painting");
  assert.equal(resolveGalleryIllustrationArtStyle("dark fantasy", undefined), "dark fantasy");
});

test("resolveGalleryIllustrationArtStyle replaces game prompt with preset text", () => {
  assert.equal(
    resolveGalleryIllustrationArtStyle("dark fantasy", "vn-cel"),
    GALLERY_ILLUSTRATION_STYLE_PRESETS["vn-cel"],
  );
});
