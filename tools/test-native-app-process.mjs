import assert from 'node:assert/strict';
import {nativeAppProcesses} from './native-app-process.mjs';
assert.deepEqual(nativeAppProcesses('  123 /work/SteleFab.app/Contents/MacOS/SteleFab --app=detailcraft\n  456 /work/Old App.app/Contents/MacOS/CadCraft Studio').map(x=>x.slice(1)),[['123','/work/SteleFab.app'],['456','/work/Old App.app']]);
for(const row of ['123 /bin/sh -c /work/SteleFab.app/Contents/MacOS/SteleFab','123 /work/Fake.app/Contents/MacOS/SteleFab --delete','123 /work/SteleFab.app/Contents/MacOS/Other'])assert.equal(nativeAppProcesses(row).length,0,row);
console.log('Compatible old/new process identity accepted;wrappers,extra flags and unrelated executables refused. No processes signaled.');
