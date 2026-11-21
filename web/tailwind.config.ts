import type { Config } from 'tailwindcss';
// An import, not require(): Node 22+ loads this file as ESM, where require is undefined.
import tixitPreset from '../packages/config/tailwind-preset.cjs';

/** Brand tokens live in the shared Tixit preset; this app only adds its content paths. */
const config: Config = {
  presets: [tixitPreset],
  content: ['./src/**/*.{ts,tsx}', '../packages/ui/src/**/*.{ts,tsx}', '../packages/session/src/**/*.{ts,tsx}'],
  plugins: [],
};

export default config;
