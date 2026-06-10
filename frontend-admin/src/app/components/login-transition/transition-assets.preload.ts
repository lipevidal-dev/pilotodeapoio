/** URLs externas da transição — SVGs principais são inline no template. */
export const TRANSITION_PRELOAD_URLS = ['assets/brand/transition-aero-texture.png'] as const;

let preloaded = false;

/** Pré-carrega textura de fundo ao abrir /login para evitar pop-in na transição. */
export function preloadTransitionAssets(): void {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = true;
  for (const url of TRANSITION_PRELOAD_URLS) {
    const img = new Image();
    img.src = url;
  }
}
