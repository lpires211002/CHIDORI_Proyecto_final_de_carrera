/**
 * Firma "ad-hoc" de la app de macOS (gratis, sin cuenta de Apple Developer).
 *
 * Sin NINGUNA firma, macOS moderno (Sequoia/Tahoe) no solo advierte: manda la
 * app al basurero con el cartel "Malware bloqueado". Una firma ad-hoc (`-`)
 * no elimina el aviso de "desarrollador no identificado", pero evita que el
 * sistema la trate como software malicioso.
 *
 * Corre automaticamente durante `npm run dist:mac`, antes de armar el .dmg.
 */
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  try {
    execFileSync('codesign', [
      '--force',
      '--deep',
      '--sign', '-',              // '-' = firma ad-hoc
      '--options', 'runtime',
      appPath,
    ], { stdio: 'inherit' });
    console.log(`  • firma ad-hoc aplicada  app=${appName}`);
  } catch (err) {
    console.warn(`  ! no se pudo firmar ad-hoc (${err.message})`);
  }
};
