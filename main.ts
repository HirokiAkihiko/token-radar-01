// Token Launch Radar — entry point (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, builds the ranked board with the
// peer-multiple model in lib/model.ts, then writes into the output folder:
//   board.json   the ranked board (gate artefact)
//   data.js      the dashboard's dataset, generated from the same board
//   dashboard/   a copy of this repo's static dashboard (no network)
//   screenshots/ a copy of this repo's three dashboard screenshots
//   dossier.json built last with buildDossier from vendor/makefun-board.ts,
//                byte-identical to what the scorer rebuilds from /output
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const TEXT_LIMIT = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const PLAIN_FILE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function optionValue(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && process.argv[at + 1]) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined ? joined.slice(name.length + 3) : fallback;
}

const inputOption = optionValue('input', '/input');
const snapshotPath = inputOption.endsWith('.json') ? inputOption : join(inputOption, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  process.stderr.write(`token radar: snapshot not found at ${snapshotPath}\n`);
  process.exit(2);
}
const outputDir = optionValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) {
  process.stderr.write(`token radar: refusing to write a board the gate rejects: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

function copyPlainFiles(sourceDir: string, targetDir: string): string[] {
  if (!existsSync(sourceDir)) return [];
  mkdirSync(targetDir, { recursive: true });
  const done: string[] = [];
  for (const entry of readdirSync(sourceDir)) {
    if (entry.startsWith('.')) continue;
    const from = join(sourceDir, entry);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(targetDir, entry));
    done.push(entry);
  }
  return done;
}

copyPlainFiles(join(repoDir, 'dashboard'), join(outputDir, 'dashboard'));
const shotsCopied = copyPlainFiles(join(repoDir, 'screenshots'), join(outputDir, 'screenshots'));
if (shotsCopied.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shotsCopied.length} files, the entry needs 3 (board, detail, filtered)\n`);
  process.exit(1);
}
for (const name of shotsCopied) {
  if (!PLAIN_FILE.test(name)) {
    process.stderr.write(`token radar: bad screenshot name ${name}\n`);
    process.exit(1);
  }
}

const dossierBytes = buildDossier(outputDir, {
  text_max_bytes: TEXT_LIMIT,
  screenshots: SHOT_LIMITS,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} watchlist, ${board.length} rows ranked (${radar.early_size} early below the floor, ${radar.live_size} live set aside)\n` +
  `token radar: overall peer multiple ${radar.overall_multiple}x TVL across ${radar.categories.length} categories with 2+ traded peers\n`,
);
