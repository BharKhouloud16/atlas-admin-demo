import { test, expect } from "@playwright/test";

// Surface exposée par Next.js 14 (plus corrigé) : l'optimiseur d'images
// /_next/image est désactivé (next.config.js, images.unoptimized). Aucune
// page n'utilise next/image ; la route ne doit donc jamais traiter d'image.
test("l'optimiseur d'images /_next/image est désactivé", async ({ request }) => {
  for (const url of ["/_next/image?url=%2Ffavicon.ico&w=64&q=75", "/_next/image?url=%2Fimage.svg&w=64&q=75"]) {
    expect((await request.get(url)).status()).toBe(404);
  }
});
