import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'test', 'scripts']) {
  for (const file of readdirSync(dir).filter(name => name.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(1);
  }
}
console.log('Syntax checks passed');
