// Only direct compatible native app processes qualify for the existing guarded restart preflight.
export function nativeAppProcesses(psOutput) {
  return psOutput.split('\n').map(line=>line.trim().match(/^(\d+) (\/.+\.app)\/Contents\/MacOS\/(?:CadCraft Studio|SteleFab)(?: --app=detailcraft)?$/)).filter(m=>m && !/\s--?\S/.test(m[2]));
}
