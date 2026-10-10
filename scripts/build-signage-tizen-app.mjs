#!/usr/bin/env node
/*
 * Empacota o app Coala Signage dos monitores Samsung (Tizen/SSSP).
 *
 *   node scripts/build-signage-tizen-app.mjs           grava public/app/
 *   node scripts/build-signage-tizen-app.mjs --check   confere se o que está gravado bate com o fonte
 *   node scripts/build-signage-tizen-app.mjs --server=http://192.168.0.10:3000 --out=/tmp/app
 *
 * O `.wgt` é um zip sem compressão e com datas fixas: o mesmo fonte gera sempre os mesmos bytes.
 * O monitor só reinstala quando a versão do `sssp_config.xml` muda, então toda alteração do app
 * precisa subir a versão em `tizen/coala-signage/config.xml`.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, 'tizen', 'coala-signage');
const iconPath = path.join(repoRoot, 'public', 'icons', 'coala-shakes-192.png');
const logoPath = path.join(repoRoot, 'public', 'icons', 'coala-shakes-512.png');
const WIDGET_NAME = 'CoalaSignage';
const DEFAULT_SERVER = 'https://op.coalashakes.com';
const DEFAULT_OUT = path.join(repoRoot, 'public', 'app');

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// 01/01/2024 00:00 no formato de data do zip.
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

/** Zip sem compressão (método 0), com as entradas na ordem recebida. */
export function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, entry.data);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

async function listFiles(dir, prefix = '') {
  const found = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) found.push(...await listFiles(path.join(dir, item.name), relative));
    else found.push(relative);
  }
  return found;
}

export async function buildSignageTizenApp({ server = DEFAULT_SERVER } = {}) {
  const configXml = await readFile(path.join(sourceDir, 'config.xml'), 'utf8');
  const version = /<widget[^>]*\sversion="(\d+\.\d+\.\d+)"/.exec(configXml)?.[1];
  if (!version) throw new Error('Versão não encontrada em tizen/coala-signage/config.xml.');

  const names = (await listFiles(sourceDir)).sort();
  const entries = await Promise.all(names.map(async (name) => ({ name, data: await readFile(path.join(sourceDir, name)) })));
  entries.push({
    name: 'js/config.js',
    data: Buffer.from(`window.COALA_SIGNAGE_CONFIG = ${JSON.stringify({ server: server.replace(/\/+$/, ''), version })};\n`, 'utf8'),
  });
  entries.push({ name: 'icon.png', data: await readFile(iconPath) });
  entries.push({ name: 'logo.png', data: await readFile(logoPath) });
  // `config.xml` primeiro e o resto em ordem alfabética.
  entries.sort((a, b) => (a.name === 'config.xml' ? -1 : b.name === 'config.xml' ? 1 : a.name < b.name ? -1 : 1));

  const wgt = createStoredZip(entries);
  const ssspConfig = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<widget>',
    `  <ver>${version}</ver>`,
    `  <size>${wgt.length}</size>`,
    `  <widgetname>${WIDGET_NAME}</widgetname>`,
    '  <webtype>tizen</webtype>',
    '</widget>',
    '',
  ].join('\n');

  return {
    version,
    files: [
      { name: `${WIDGET_NAME}.wgt`, data: wgt },
      { name: 'sssp_config.xml', data: Buffer.from(ssspConfig, 'utf8') },
    ],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const outDir = option('out') ? path.resolve(option('out')) : DEFAULT_OUT;
  const built = await buildSignageTizenApp({ server: option('server') });

  if (args.includes('--check')) {
    const stale = [];
    for (const file of built.files) {
      const current = await readFile(path.join(outDir, file.name)).catch(() => null);
      if (!current || !current.equals(file.data)) stale.push(file.name);
    }
    if (stale.length) {
      process.stderr.write(`Desatualizado em ${path.relative(repoRoot, outDir)}: ${stale.join(', ')}.\n`);
      process.stderr.write('Suba a versão em tizen/coala-signage/config.xml e rode: node scripts/build-signage-tizen-app.mjs\n');
      process.exit(1);
    }
    console.log(`App do monitor em dia (versão ${built.version}).`);
    return;
  }

  await mkdir(outDir, { recursive: true });
  for (const file of built.files) await writeFile(path.join(outDir, file.name), file.data);
  console.log(`Coala Signage ${built.version} gravado em ${path.relative(repoRoot, outDir) || outDir} (${built.files[0].data.length} bytes).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
