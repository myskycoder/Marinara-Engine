import type { BuiltInAgentManifest } from "../agent-manifest.types.js";

export const illustratorAgentManifest = {
  id: "illustrator",
  name: "Illustrator",
  description: "Generates image prompts for key scenes (requires image generation API).",
  phase: "post_processing",
  enabledByDefault: false,
  category: "misc",
  defaultTools: [],
  defaultSettings: {
    useAvatarReferences: false,
  },
  promptTemplates: [
    {
      id: "illustration",
      name: "Illustration",
      description: "Single-scene cinematic illustration prompt.",
      promptTemplate: `After key narrative moments, generate a detailed image prompt for an image generation service.
Anchor your decision to <assistant_response>, meaning the latest assistant turn. Use recent context only to understand continuity, character positions, setting, and mood.
Only generate a prompt when the latest moment is visually significant: dramatic action, key emotion, major reveal, transformation, tense confrontation, important location, or new visually described character.
If the moment does not warrant an image, return shouldGenerate false and briefly explain why.
Return valid JSON only:
{
  "shouldGenerate": boolean,
  "reason": "why this moment warrants an image, or why not",
  "prompt": "detailed image generation prompt if shouldGenerate is true",
  "negativePrompt": "what to avoid in generation",
  "style": "cinematic anime fantasy illustration, detailed lighting, polished digital painting",
  "aspectRatio": "landscape|portrait|square",
  "characters": ["visible character name", "visible character name"]
}
Prompt quality rules:
1. Describe the full scene, camera angle, composition, lighting, mood, atmosphere, and environment.
2. Describe every visible character and the user's persona directly in the prompt: hair color, hair length and style, eye color, skin tone/complexion/carnation, build, clothing, posture, expression, and distinguishing features.
3. For action, emphasize dynamic poses, foreshortening, debris, particles, fabric movement, and motion blur.
4. For emotion, emphasize facial expression, lighting, body language, and atmosphere.
5. Include only visual image content in the prompt. Do not include meta-instructions.
6. The characters array must list every named visible character.
The negativePrompt must always include: watermark, logo, signature, bad anatomy, malformed hands, extra limbs, blurry, low quality`,
    },
    {
      id: "comic-page",
      name: "Comic Page",
      description: "Colored manga page with panels, speech bubbles, and sound effects.",
      promptTemplate: `After key narrative moments, generate a detailed image prompt for an image generation service, styled as a COLORED MANGA COMIC PAGE depicting what just happened.
Anchor your decision to <assistant_response>, meaning the latest assistant turn. Use recent context only to understand continuity, character positions, setting, and mood. Do not illustrate an older scene just because it appears in context.
Only generate a prompt when the latest moment is visually significant: dramatic action, key emotion, major reveal, transformation, tense confrontation, power shift, or a comedic reaction beat.
If the moment does not warrant an image, return shouldGenerate false and briefly explain why.
Return valid JSON only:
{
  "shouldGenerate": boolean,
  "reason": "why this moment warrants an image, or why not",
  "prompt": "detailed image generation prompt if shouldGenerate is true",
  "negativePrompt": "what to avoid in generation",
  "style": "colored manga comic page, Japanese manga style, panel layout, cell shading, flat colors, screentone shading",
  "aspectRatio": "portrait|landscape|square",
  "characters": ["visible character name", "visible character name"]
}
Prompt quality rules:
1. Frame the image as a colored manga comic page with 2 to 6 panels. Choose panel count and composition deliberately: close-ups for emotion, wide shots for action, dutch angles for tension, impact panels for reveals.
2. Include dialogue boxes, speech bubbles, captions, and manga sound effect lettering only when the latest assistant turn contains dialogue or action that should appear on the comic page. Keep text short and directly drawn from the scene.
3. Describe every visible character and the user's persona directly in the prompt: hair color, hair length and style, eye color, skin tone/complexion/carnation, build, clothing, posture, expression, and distinguishing features.
4. Use manga visual language: screentone gradients, speed lines, impact frames, dramatic shadows, motion blur, sparkle effects, sweat drops, cross-popping veins, rim lighting, and expressive panel composition.
5. Specify camera framing per panel, such as extreme close-up, bust shot, full body, bird's-eye view, worm's-eye view, over-the-shoulder, or wide establishing shot.
6. Always include these style keywords in the prompt: colored manga, comic page, panels, cell shading, flat colors, and screentone shading.
7. Do not mention attached files or reference images yourself. The application adds reference-image instructions separately.
8. The characters array must list every named visible character.
The negativePrompt must always include: watermark, logo, signature, unreadable text, broken lettering, malformed speech bubbles`,
    },
    {
      id: "sketch",
      name: "Sketch",
      description: "Expressive monochrome sketch prompt for quick scene studies.",
      promptTemplate: `After key narrative moments, generate a detailed image prompt for an image generation service, styled as an expressive monochrome sketch.
Anchor your decision to <assistant_response>, meaning the latest assistant turn. Use recent context only to understand continuity, character positions, setting, and mood.
Only generate a prompt when the latest moment is visually significant: dramatic action, key emotion, major reveal, transformation, tense confrontation, important location, or comedic reaction.
If the moment does not warrant an image, return shouldGenerate false and briefly explain why.
Return valid JSON only:
{
  "shouldGenerate": boolean,
  "reason": "why this moment warrants an image, or why not",
  "prompt": "detailed image generation prompt if shouldGenerate is true",
  "negativePrompt": "what to avoid in generation",
  "style": "expressive manga sketch, monochrome pencil lines, ink wash shading, rough storyboard energy",
  "aspectRatio": "landscape|portrait|square",
  "characters": ["visible character name", "visible character name"]
}
Prompt quality rules:
1. Describe the scene as a hand-drawn sketch with strong silhouettes, confident line weight, visible pencil/ink texture, loose construction lines, and selective shading.
2. Describe every visible character and the user's persona directly in the prompt: hair color, hair length and style, eye color when visible, skin tone/complexion/carnation, build, clothing, posture, expression, and distinguishing features.
3. For action, emphasize gesture, motion arcs, speed lines, foreshortening, and rough impact marks.
4. For emotion, emphasize facial expression, posture, hand placement, shadows, and the negative space around the characters.
5. Do not include dialogue text, speech bubbles, captions, signs, subtitles, UI text, logos, signatures, or watermarks.
6. The characters array must list every named visible character.
The negativePrompt must always include: color painting, full render, photorealism, dialogue boxes, speech bubbles, captions, watermark, logo, signature`,
    },
  ],
  runInterval: 5,
} satisfies BuiltInAgentManifest;
