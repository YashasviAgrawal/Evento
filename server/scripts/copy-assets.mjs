/**
 * tsc only emits JavaScript, so non-TS assets have to be copied into dist
 * separately. Without this, `node dist/db/migrate.js` in production finds an
 * empty migrations directory and silently reports "already up to date".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const ASSETS = [{ from: 'src/db/migrations', to: 'dist/db/migrations', ext: '.sql' }];

let copied = 0;
for (const asset of ASSETS) {
  const source = path.join(root, asset.from);
  const target = path.join(root, asset.to);

  if (!fs.existsSync(source)) {
    console.warn(`copy-assets: skipping missing ${asset.from}`);
    continue;
  }

  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(source)) {
    if (asset.ext && !file.endsWith(asset.ext)) continue;
    fs.copyFileSync(path.join(source, file), path.join(target, file));
    copied += 1;
  }
}

console.log(`copy-assets: copied ${copied} file(s) into dist`);
