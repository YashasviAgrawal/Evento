import type { Config } from 'tailwindcss';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tixitPreset = require('../packages/config/tailwind-preset.cjs');

/** Brand tokens come from the shared Tixit preset — the same source as www.tixit.in. */
const config: Config = {
  presets: [tixitPreset],
  content: ['./src/**/*.{ts,tsx}', '../packages/ui/src/**/*.{ts,tsx}', '../packages/session/src/**/*.{ts,tsx}'],
  plugins: [],
};

export default config;
