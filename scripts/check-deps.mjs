import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));

const expected = {
  typescript: pkg.devDependencies.typescript,
  'lucide-react': pkg.dependencies['lucide-react'],
};

for (const [name, range] of Object.entries(expected)) {
  const entry = lock.packages?.[`node_modules/${name}`];
  if (!entry?.version) throw new Error(`Missing locked package: ${name}`);
  console.log(`${name}: ${entry.version} (requested ${range})`);
}

if (lock.packages?.['node_modules/lucide-react']?.version !== '0.546.0') {
  throw new Error('Unexpected lucide-react lock version');
}
if (lock.packages?.['node_modules/typescript']?.version !== '7.0.2') {
  throw new Error('Unexpected TypeScript lock version');
}
