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

  // ★ NO firmar los builds por arquitectura (carpetas *-temp): al fusionarlos
  // en el binario universal, @electron/universal exige que los archivos NO
  // binarios sean identicos entre x64 y arm64, y cada firma genera un
  // _CodeSignature/CodeResources distinto -> "Expected all non-binary files
  // to have identical SHAs". Solo firmamos el universal ya fusionado.
  if (context.appOutDir.endsWith('-temp')) return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  try {
    // OJO: NO usar '--options runtime' (Hardened Runtime). Activa validacion
    // estricta de librerias y, sin los entitlements de Electron (allow-jit,
    // disable-library-validation), la app crashea al arrancar con
    // "Library not loaded: @rpath/Electron Framework.framework".
    // El hardened runtime solo hace falta para notarizar con cuenta Apple.
    execFileSync('codesign', [
      '--force',
      '--deep',
      '--sign', '-',              // '-' = firma ad-hoc
      appPath,
    ], { stdio: 'inherit' });
    console.log(`  • firma ad-hoc aplicada  app=${appName}`);
  } catch (err) {
    console.warn(`  ! no se pudo firmar ad-hoc (${err.message})`);
  }
};
