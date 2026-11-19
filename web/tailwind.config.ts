import type { Config } from 'tailwindcss';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tixitPreset = require('../packages/config/tailwind-preset.cjs');

/** Brand tokens live in the shared Tixit preset; this app only adds its content paths. */
const config: Config = {
  presets: [tixitPreset],
  content: ['./src/**/*.{ts,tsx}', '../packages/ui/src/**/*.{ts,tsx}', '../packages/session/src/**/*.{ts,tsx}'],
  plugins: [],
};

export default config;
