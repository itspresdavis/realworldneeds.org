import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
async function snapshot(root='dist', path='') {
  const files={};
  for(const item of await readdir(join(root,path),{withFileTypes:true})) {
    const name=join(path,item.name);
    if(item.isDirectory()) Object.assign(files,await snapshot(root,name));
    else files[name]=createHash('sha256').update(await readFile(join(root,name))).digest('hex');
  }
  return files;
}
const before=await snapshot();
const build=spawnSync('npm',['run','build'],{stdio:'inherit'});
if(build.status!==0)process.exit(build.status||1);
const after=await snapshot();
const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(path=>before[path]!==after[path]);
if(changed.length)throw new Error('Build is not reproducible; changed outputs:\n'+changed.join('\n'));
console.log('Reproducible build: all '+Object.keys(after).length+' output SHA-256 hashes match.');
