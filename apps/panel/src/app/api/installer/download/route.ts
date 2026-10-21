import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { GenericInstallerPackageSchema } from '@appremoto/contracts';

const GENERIC_MARKER = Buffer.from('XPOINT_GENERIC_V1', 'utf8');

function resolvePublicDir(): string {
  const direct = path.join(process.cwd(), 'public');
  if (existsSync(path.join(direct, 'installers', 'complete-manifest.json'))) {
    return direct;
  }
  const nested = path.join(process.cwd(), 'apps', 'panel', 'public');
  if (existsSync(path.join(nested, 'installers', 'complete-manifest.json'))) {
    return nested;
  }
  return direct;
}

function decodeBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

export async function GET(request: NextRequest) {
  const encodedPkg = request.nextUrl.searchParams.get('p');
  const archParam = request.nextUrl.searchParams.get('arch');
  const isX86 = archParam === 'x86' || archParam === '32';
  const isWin7 = archParam === 'win7' || archParam === 'w7';

  if (!encodedPkg) {
    return NextResponse.json(
      { error: { code: 'MISSING_PACKAGE', message: 'Link de instalador inválido ou incompleto.' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  let parsedPkg: ReturnType<typeof GenericInstallerPackageSchema.safeParse>;
  try {
    const rawJson = decodeBase64Url(encodedPkg);
    parsedPkg = GenericInstallerPackageSchema.safeParse(JSON.parse(rawJson));
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_PACKAGE', message: 'Link de instalador inválido.' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  if (!parsedPkg.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_PACKAGE', message: 'Dados de autorização do instalador inválidos.' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  try {
    const publicDir = resolvePublicDir();
    const manifestName = isWin7
      ? 'complete-manifest-win7.json'
      : isX86
        ? 'complete-manifest-x86.json'
        : 'complete-manifest.json';
    const defaultExePath = isWin7
      ? '/installers/xpoint-complete-1.3.6-win7.exe'
      : isX86
        ? '/installers/xpoint-complete-1.3.6-x86.exe'
        : '/installers/xpoint-complete-1.3.6.exe';
    const downloadFilename = isWin7
      ? 'XPoint-Instalar-Completo-Win7.exe'
      : isX86
        ? 'XPoint-Instalar-Completo-32bits.exe'
        : 'XPoint-Instalar-Completo.exe';

    const manifestRaw = await readFile(path.join(publicDir, 'installers', manifestName), 'utf8');
    const manifest = JSON.parse(manifestRaw) as { path?: string };
    const relativePath = (manifest.path || defaultExePath).replace(/^\/+/, '');
    const exePath = path.join(publicDir, relativePath);
    const baseBytes = await readFile(exePath);

    const pkgBytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        installerId: parsedPkg.data.installerId,
        installerToken: parsedPkg.data.installerToken,
      }),
      'utf8'
    );
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(pkgBytes.byteLength, 0);

    const fullBuffer = Buffer.concat([baseBytes, pkgBytes, sizeBuf, GENERIC_MARKER]);

    return new NextResponse(fullBuffer, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${downloadFilename}"`,
        'content-length': String(fullBuffer.byteLength),
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'INSTALLER_UNAVAILABLE', message: 'Não foi possível preparar o arquivo do instalador.' } },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
}
