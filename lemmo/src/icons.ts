// Inline SVG icons (stroke = currentColor) for skills and HUD buttons.
const svg = (body: string) =>
  `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  climber: svg('<path d="M10 4v24M22 4v24M10 9h12M10 16h12M10 23h12"/><path d="M16 2l-3 3M16 2l3 3" stroke="#5df2b0"/>'),
  floater: svg('<path d="M4 15a12 10 0 0 1 24 0z" fill="#ff4d5e" stroke="#ff8a96"/><path d="M10 15a6 9 0 0 1 12 0" stroke="#ffd23f"/><path d="M16 15v10a3 3 0 0 1-6 0"/>'),
  bomber: svg('<circle cx="14" cy="19" r="9" fill="#2b2f45"/><path d="M20 12l4-4"/><path d="M24 8l3-1M24 8l1-3M24 8l3 2" stroke="#ffc857"/>'),
  blocker: svg('<circle cx="16" cy="7" r="3"/><path d="M16 10v10M5 13h22M16 20l-5 8M16 20l5 8"/>'),
  builder: svg('<path d="M4 27h7v-6h7v-6h7v-6h4" /><path d="M4 27h24" stroke-opacity=".4"/>'),
  basher: svg('<path d="M5 16h14"/><path d="M15 10l6 6-6 6"/><path d="M24 6v20" stroke-dasharray="3 3" stroke="#ffc857"/>'),
  miner: svg('<path d="M7 25L21 11"/><path d="M14 5c6 0 12 4 13 10-4-3-8-5-13-10z" fill="currentColor" fill-opacity=".25"/><path d="M22 22l5 5" stroke="#ffc857" stroke-dasharray="2 3"/>'),
  digger: svg('<path d="M16 4v14"/><path d="M10 18h12l-2 7h-8z" fill="currentColor" fill-opacity=".25"/><path d="M8 29h16" stroke="#ffc857" stroke-dasharray="2 3"/>'),
  nuke: svg('<circle cx="16" cy="16" r="3" fill="currentColor"/><path d="M16 13l-4-7a9 9 0 0 1 8 0zM18.6 17.5l8 .5a9 9 0 0 1-4 7zM13.4 17.5l-4 7a9 9 0 0 1-4-7z" fill="currentColor"/>'),
  pause: svg('<path d="M11 7v18M21 7v18"/>'),
  play: svg('<path d="M10 6l16 10-16 10z" fill="currentColor"/>'),
  fast: svg('<path d="M5 8l10 8-10 8zM17 8l10 8-10 8z" fill="currentColor"/>'),
  sound: svg('<path d="M5 12h5l7-6v20l-7-6H5z" fill="currentColor"/><path d="M21 11a6 6 0 0 1 0 10M24 7a11 11 0 0 1 0 18"/>'),
  mute: svg('<path d="M5 12h5l7-6v20l-7-6H5z" fill="currentColor"/><path d="M22 12l6 8M28 12l-6 8"/>'),
  music: svg('<path d="M12 24V7l14-3v17"/><circle cx="8.5" cy="24" r="3.5" fill="currentColor"/><circle cx="22.5" cy="21" r="3.5" fill="currentColor"/>'),
  info: svg('<circle cx="16" cy="16" r="12"/><path d="M16 14v8"/><circle cx="16" cy="9.5" r="1.4" fill="currentColor" stroke="none"/>'),
  back: svg('<path d="M19 6L9 16l10 10"/>'),
  menu: svg('<path d="M6 9h20M6 16h20M6 23h20"/>'),
  panorama: svg('<rect x="3" y="8" width="26" height="16" rx="3"/><path d="M3 16h26M12 8v16M20 8v16" stroke-opacity=".5"/>'),
  cylinder: svg('<ellipse cx="16" cy="7" rx="10" ry="3.5"/><path d="M6 7v18c0 2 4.5 3.5 10 3.5s10-1.5 10-3.5V7"/>'),
  restart: svg('<path d="M7 16a9 9 0 1 0 3-6.7"/><path d="M6 4v6h6"/>'),
};
