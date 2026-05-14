import test from "node:test";
import assert from "node:assert/strict";
import {
  detectImageModelFamily,
  getImageModelFamilyInfo,
  type ImageModelFamily,
} from "@marinara-engine/shared";

function familyOf(input: Parameters<typeof detectImageModelFamily>[0]): ImageModelFamily {
  return detectImageModelFamily(input).family;
}

test("Pollinations service routes to pollinations family", () => {
  assert.equal(
    familyOf({
      service: "pollinations",
      provider: "image_generation",
      model: "flux",
      baseUrl: "https://image.pollinations.ai",
    }),
    "pollinations",
  );
});

test("ComfyUI service with vanilla model routes to comfyui family", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "anythingv5.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "comfyui",
  );
});

test("ComfyUI service with a Pony checkpoint promotes to pony family", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "ponyDiffusionV6XL_v6StartWithThisOne.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "pony",
  );
});

test("ComfyUI service with a Flux checkpoint promotes to flux family", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "flux1-dev-Q4_K_S.gguf",
      baseUrl: "http://localhost:8188",
    }),
    "flux",
  );
});

test("OpenAI dall-e-3 routes to dalle3 family", () => {
  assert.equal(
    familyOf({
      service: "openai",
      provider: "image_generation",
      model: "dall-e-3",
      baseUrl: "https://api.openai.com/v1",
    }),
    "dalle3",
  );
});

test("OpenAI gpt-image-1 routes to gpt_image family", () => {
  assert.equal(
    familyOf({
      service: "openai",
      provider: "image_generation",
      model: "gpt-image-1",
      baseUrl: "https://api.openai.com/v1",
    }),
    "gpt_image",
  );
});

test("Together.ai with FLUX model routes to flux family", () => {
  assert.equal(
    familyOf({
      service: "togetherai",
      provider: "image_generation",
      model: "black-forest-labs/FLUX.1-schnell-Free",
      baseUrl: "https://api.together.xyz/v1",
    }),
    "flux",
  );
});

test("OpenRouter with FLUX model routes to flux family", () => {
  assert.equal(
    familyOf({
      service: "openrouter",
      provider: "image_generation",
      model: "black-forest-labs/flux-1.1-pro",
      baseUrl: "https://openrouter.ai/api/v1",
    }),
    "flux",
  );
});

test("NovelAI v3 model routes to novelai_v3 family", () => {
  assert.equal(
    familyOf({
      service: "novelai",
      provider: "image_generation",
      model: "nai-diffusion-3",
      baseUrl: "https://image.novelai.net",
    }),
    "novelai_v3",
  );
});

test("NovelAI v4 curated model routes to novelai_v4 family", () => {
  assert.equal(
    familyOf({
      service: "novelai",
      provider: "image_generation",
      model: "nai-diffusion-4-curated-preview",
      baseUrl: "https://image.novelai.net",
    }),
    "novelai_v4",
  );
});

test("Stability SD3 routes to sdxl_natural family", () => {
  assert.equal(
    familyOf({
      service: "stability",
      provider: "image_generation",
      model: "sd3-medium",
      baseUrl: "https://api.stability.ai",
    }),
    "sdxl_natural",
  );
});

test("Automatic1111 with SDXL checkpoint routes to sdxl_booru family", () => {
  assert.equal(
    familyOf({
      service: "automatic1111",
      provider: "image_generation",
      model: "juggernautXL_v9.safetensors",
      baseUrl: "http://localhost:7860",
    }),
    "sdxl_booru",
  );
});

test("ComfyUI with an Illustrious-XL checkpoint routes to illustrious family", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "Illustrious-XL-v0.1.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "illustrious",
  );
});

test("ComfyUI with a NoobAI checkpoint routes to illustrious family", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "noobai-XL-vPred-1.0.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "illustrious",
  );
});

test("ComfyUI with a WAI-* PonyXL fork stays on pony family (it IS pony)", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "wai-ani-nsfw-ponyxl-v11.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "pony",
  );
});

test("ComfyUI with a WAI-* Illustrious fork routes to illustrious family", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "wai-ani-illustrious-v14.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "illustrious",
  );
});

test("ComfyUI with smushed Illustrious filename routes to illustrious family", () => {
  // Real-world checkpoint filenames often glue tokens without separators —
  // `\b` regex misses these. This guards the .includes() based detector.
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "illustriousXL_v01.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "illustrious",
  );
});

test("ComfyUI with smushed NoobAI filename routes to illustrious family", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "noobaiXLNAIXL_vPred10Version.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "illustrious",
  );
});

test("ComfyUI with smushed obsessionIllustrious filename routes to illustrious", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "obsessionillustriousxl_v15.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "illustrious",
  );
});

test("Automatic1111 with an Illustrious checkpoint routes to illustrious family", () => {
  // A1111 normally falls through to sdxl_booru, but when the user is running
  // an Illustrious checkpoint we want the dedicated guide to kick in.
  assert.equal(
    familyOf({
      service: "automatic1111",
      provider: "image_generation",
      model: "Illustrious-XL-v1.safetensors",
      baseUrl: "http://localhost:7860",
    }),
    "illustrious",
  );
});

test("ComfyUI with a Hassaku-IL checkpoint routes to illustrious family", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "hassaku-il-v22.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "illustrious",
  );
});

test("ComfyUI with an Animagine checkpoint stays on sdxl_booru (not Illustrious)", () => {
  assert.equal(
    familyOf({
      service: "comfyui",
      provider: "image_generation",
      model: "animagine-xl-3.1.safetensors",
      baseUrl: "http://localhost:8188",
    }),
    "sdxl_booru",
  );
});

test("Automatic1111 fallback (unknown model) defaults to sdxl_booru family", () => {
  assert.equal(
    familyOf({
      service: "automatic1111",
      provider: "image_generation",
      model: "anything",
      baseUrl: "http://localhost:7860",
    }),
    "sdxl_booru",
  );
});

test("Gemini image model routes to imagen family", () => {
  assert.equal(
    familyOf({
      service: "openrouter",
      provider: "image_generation",
      model: "google/gemini-2.5-flash-image",
      baseUrl: "https://openrouter.ai/api/v1",
    }),
    "imagen",
  );
});

test("Horde service routes to horde family", () => {
  assert.equal(
    familyOf({
      service: "horde",
      provider: "image_generation",
      model: "AlbedoBase XL (SDXL)",
      baseUrl: "https://stablehorde.net",
    }),
    "horde",
  );
});

test("Empty service is inferred from base URL (Pollinations)", () => {
  assert.equal(
    familyOf({
      service: null,
      provider: null,
      model: "",
      baseUrl: "https://image.pollinations.ai",
    }),
    "pollinations",
  );
});

test("Truly unknown connection falls back to generic family", () => {
  assert.equal(
    familyOf({
      service: "some-future-service",
      provider: "image_generation",
      model: "mystery-model-x",
      baseUrl: "https://example.com/api",
    }),
    "generic",
  );
});

test("Every family info entry has a non-empty style guide", () => {
  const families: ImageModelFamily[] = [
    "sdxl_booru",
    "sdxl_natural",
    "illustrious",
    "pony",
    "flux",
    "dalle3",
    "gpt_image",
    "imagen",
    "novelai_v3",
    "novelai_v4",
    "pollinations",
    "comfyui",
    "stability",
    "horde",
    "generic",
  ];
  for (const family of families) {
    const info = getImageModelFamilyInfo(family);
    assert.equal(info.family, family, `family id should round-trip for ${family}`);
    assert.ok(info.label.length > 0, `label should be set for ${family}`);
    assert.ok(info.promptStyleGuide.length >= 40, `style guide should be substantive for ${family}`);
  }
});

test("Unknown family id falls back to generic via getImageModelFamilyInfo", () => {
  const info = getImageModelFamilyInfo("not-a-family");
  assert.equal(info.family, "generic");
});
