// Colours and type from docs/BRAND.md and the app's light theme (web/src/theme.css). One typeface for the
// video's own words, IBM Plex Sans; code (the terminal, the diff, commands) is IBM Plex Mono, as in the app.
import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

export const C = {
  canvas: '#f2f2f3',
  surface: '#ffffff',
  hair: '#e4e4e7',
  ink: '#18181b',
  ink2: '#52525b',
  ink3: '#a1a1aa',
  accent: '#7C2BEE',
  add: '#1a7a39',
  addBg: '#e3f2e7',
  del: '#c1272f',
  delBg: '#fbe8e9',
  claude: '#B34A20',
};
export const SANS = "'IBM Plex Sans', system-ui, sans-serif";
export const MONO = "'IBM Plex Mono', ui-monospace, monospace";
export const SHADOW = `0 0 0 1px ${C.hair}, 0 12px 40px rgba(24, 24, 27, 0.08)`;
/** The app's dark theme (web/src/theme.css): the problem scenes, and Review's focus on code. */
export const D = {
  canvas: '#08080a',
  surface: '#151517',
  hair: '#26262a',
  ink: '#ededef',
  ink2: '#a1a1aa',
  claude: '#d97757',
  add: '#3fb950',
};
export const SHADOW_DARK = `0 0 0 1px ${D.hair}, 0 12px 40px rgba(0, 0, 0, 0.5)`;

const font = (family: string, file: string, weight: string) =>
  loadFont({ family, url: staticFile(`fonts/${file}`), weight });
export const fontsLoaded = Promise.all([
  font('IBM Plex Sans', 'ibm-plex-sans-latin-400-normal.woff2', '400'),
  font('IBM Plex Sans', 'ibm-plex-sans-latin-500-normal.woff2', '500'),
  font('IBM Plex Sans', 'ibm-plex-sans-latin-600-normal.woff2', '600'),
  loadFont({ family: 'IBM Plex Sans', url: staticFile('fonts/ibm-plex-sans-latin-500-italic.woff2'), weight: '500', style: 'italic' }),
  font('IBM Plex Mono', 'ibm-plex-mono-latin-400-normal.woff2', '400'),
  font('IBM Plex Mono', 'ibm-plex-mono-latin-500-normal.woff2', '500'),
]);
