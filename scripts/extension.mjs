// Builds the zip to upload to the Chrome Web Store.
//
//   npm run extension      -> dist/clauseguard-extension-<version>.zip
//
// The localhost match that the unpacked extension uses for testing is left out of the zip.

import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = new URL('../dist/extension/', import.meta.url);
rmSync(tmp, { recursive: true, force: true });
cpSync(new URL('../extension/', import.meta.url), tmp, { recursive: true });

const file = new URL('manifest.json', tmp);
const m = JSON.parse(readFileSync(file));
for (const c of m.content_scripts) c.matches = c.matches.filter((x) => !x.startsWith('http://localhost'));
writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);

const zip = fileURLToPath(new URL(`../dist/clauseguard-extension-${m.version}.zip`, import.meta.url));
rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-q', '-X', zip, '.', '-x', '*.DS_Store'], { cwd: fileURLToPath(tmp) });
rmSync(tmp, { recursive: true });
console.log(`wrote ${zip}`);
