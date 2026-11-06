// Configure the existing native shell for SteleFab without changing compatible identifiers or baseline bundles.
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),at=args.indexOf('--out');
if(at<0||!args[at+1])throw Error('Usage: node prepare-stelefab-native.mjs --out <fresh directory>');
const out=path.resolve(args[at+1]);if(fs.existsSync(out))throw Error('Refusing existing output directory');
const shell=path.resolve('cadcraft-desktop-shell'),config=JSON.parse(fs.readFileSync(path.join(shell,'stage/studio/tauri.override.json'),'utf8'));
config.productName='SteleFab';config.mainBinaryName='SteleFab';
config.bundle.shortDescription='SteleFab';
config.bundle.icon=['icon.png','32x32.png','128x128.png','icon.icns','icon.ico'].map(f=>'../assets/stelefab/icons/'+f);
if(config.identifier!=='com.getcadcraft.studio')throw Error('Unexpected baseline identity');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'tauri.override.json'),JSON.stringify(config,null,2)+'\n');
console.log(path.join(out,'tauri.override.json'));
