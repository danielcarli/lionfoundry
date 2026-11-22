/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Thin-stroke icons (codicon style), drawn inline as SVG.
const svg = (body, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const paths = {
  pointAdd: '<rect x="3.5" y="12.5" width="8" height="8" rx="1"/><path d="M17 2.5v9M12.5 7h9" stroke-width="2.2"/>',
  pointRemove: '<rect x="3.5" y="12.5" width="8" height="8" rx="1"/><path d="M12.5 7h9" stroke-width="2.2"/>',
  scale: '<rect x="3.5" y="11.5" width="9" height="9" rx="1"/><path d="M12.5 11.5 20 4M14.5 4H20v5.5"/>',
  magnet: '<path d="M6 4h4v8a2 2 0 0 0 4 0V4h4v8a6 6 0 0 1-12 0z"/><path d="M6 8h4M14 8h4"/>',
  guides: '<path d="M3 8h18M9 3v18"/><path d="M4 20L20 12" stroke-dasharray="2.5 2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cursor: '<path d="M6 3.5l12 9-5.2 1-1 5.5z"/><path d="M13 13.5l3.5 6"/>',
  pen: '<path d="M4 20l1.2-5.2L15.8 4.2a1.7 1.7 0 0 1 2.4 0l1.6 1.6a1.7 1.7 0 0 1 0 2.4L9.2 18.8z"/><path d="M13.8 6.2l4 4M4 20l4-1"/>',
  save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  export: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
  redo: '<path d="M15 5l4 4-4 4"/><path d="M19 9H10a5 5 0 0 0 0 10h3"/>',
  code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  family: '<path d="M3 19L7 7h1l4 12M4.7 15h5.6"/><path d="M13 19l3-9h1l3 9M14.3 16h4.4" stroke-width="2.6"/>',
  feature: '<path d="M4 6h8M4 12h5M4 18h8"/><path d="M14 9l3 3-3 3M17 12h4"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/>',
  glyph: '<path d="M4 19c0-9 4-14 8-14s8 5 8 14"/><path d="M2.5 19h3M18.5 19h3M10.5 5h3"/><path d="M12 5L5 9M12 5l7 4"/><circle cx="5" cy="9" r="1" fill="currentColor"/><circle cx="19" cy="9" r="1" fill="currentColor"/>',
  type: '<path d="M4 19L9.5 5h1L16 19M6 14h8"/><path d="M17 12.5a2.3 2.3 0 0 1 4 1.5v5M21 15.5c-3-.4-4.5.6-4.5 2 0 2 3.5 2 4.5 0"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.5 11h5M11 8.5v5"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.5 11h5"/>',
  chevronLeft: '<path d="M14.5 6l-6 6 6 6"/>',
  points: '<path d="M5 18C5 9 9 6 18 6"/><rect x="3" y="16" width="4" height="4" rx=".6" fill="currentColor"/><rect x="16" y="4" width="4" height="4" rx=".6" fill="currentColor"/><circle cx="6" cy="8" r="1.4"/><path d="M5 16l.8-6.5"/>',
  ruler: '<path d="M3.5 15.5l12-12 5 5-12 12z"/><path d="M7.5 11.5l2 2M10.5 8.5l2 2M13.5 5.5l2 2"/>',
  anchor: '<circle cx="12" cy="5.5" r="2"/><path d="M12 7.5V20M5 13c0 4 3 7 7 7s7-3 7-7M8.5 11h7"/>',
  fill: '<path d="M5 19c0-8 3-13 7-13s7 5 7 13z" fill="currentColor" stroke="none"/>',
  kerning: '<path d="M3 18L7.5 6l4.5 12M13 6l4 12 4-12"/><path d="M10 21h5M10 21l1.5-1.5M10 21l1.5 1.5M15 21l-1.5-1.5M15 21l-1.5 1.5"/>',
  import: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5"/><path d="M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3"/>',
  map: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M11 4v16M11 12h10M16 12v8"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  folderOpen: '<path d="M3 18.5V6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h7.8A1.5 1.5 0 0 1 20 8.7V10"/><path d="M3 18.5l2.6-7.1A1.5 1.5 0 0 1 7 10.4h13.6a1 1 0 0 1 .95 1.3L19.4 18.9a1.5 1.5 0 0 1-1.4 1.1H4.5A1.5 1.5 0 0 1 3 18.5z"/>',
  reveal: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M10 15.5l4-4M11 11.5h3v3"/>',
  trash: '<path d="M4 7h16M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v6M14 11v6"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  sparkle: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>',
  chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  warning: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.5 4.5v15"/>',
  arrowUpRight: '<path d="M7 17L17 7M9 7h8v8"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  organize: '<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h3.6l1.7 1.8H19a1.5 1.5 0 0 1 1.5 1.5v9.7A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M8 11.5h3.5M8 15h6M14.5 11.5h1.5"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  undo: '<path d="M9 7.5L4.5 12 9 16.5"/><path d="M4.5 12H15a4.5 4.5 0 0 1 0 9h-2"/>',
  shield: '<path d="M12 3.5l7.5 3v5.2c0 4.4-3.1 7.9-7.5 9.3-4.4-1.4-7.5-4.9-7.5-9.3V6.5z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  rename: '<path d="M4 7h10M4 12h7M4 17h5"/><path d="M14.5 19.5l1-3.5 4.6-4.6a1.6 1.6 0 0 1 2.3 2.3L17.8 18.3z"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/><path d="M12 8v4.5l3 1.8"/>',
  hash: '<path d="M9.5 4l-2 16M16.5 4l-2 16M4.5 9h15M3.5 15h15"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z"/>',
  disk: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 14h17M17 16.5h.01"/>',
};

export function icon(name, size) {
  return svg(paths[name] || '', size);
}
