import fs from 'node:fs';
import path from 'node:path';

type Row = Record<string, string>;

const input = process.argv[2] ?? 'data/fc27-authorized.csv';
const threshold = Number(process.argv[3] ?? 79);
const remoteInput = /^https?:\/\//i.test(input);

if (!Number.isFinite(threshold) || threshold < 0 || threshold > 99) {
  throw new Error('Usage: npm run import:fc27 -- <csv> [minimumOverall]');
}
async function readInput(source: string): Promise<string> {
  if (!/^https?:\/\//i.test(source)) {
    if (!fs.existsSync(source)) throw new Error(`Missing ${source}. Provide an authorized/licensed FC27 CSV export.`);
    return fs.readFileSync(source, 'utf8');
  }
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Unable to download FC27 snapshot: HTTP ${response.status}`);
  return await response.text();
}

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift()?.map(h => h.replace(/^\uFEFF/, '').trim()) ?? [];
  return rows.filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i].trim()])));
}

const get = (r: Row, ...names: string[]) => {
  for (const name of names) if (r[name] !== undefined && r[name] !== '') return r[name];
  return '';
};
const num = (r: Row, ...names: string[]) => Number(get(r, ...names));
const clean = (value: string) => value.trim();

const positions = new Set(['GK','CB','LB','RB','LWB','RWB','CDM','CM','CAM','LM','RM','LW','RW','ST','CF']);
const normalizePosition = (value: string) => {
  const tokens = value.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  return tokens.find(token => positions.has(token)) ?? value.toUpperCase();
};

const category = (position: string) =>
  position === 'GK' ? 'GK' :
  ['CB','LB','RB','LWB','RWB'].includes(position) ? 'DEF' :
  ['CDM','CM','CAM','LM','RM'].includes(position) ? 'MID' : 'ATT';

const players: string[] = [];
const ids = new Set<string>();

for (const row of parseCsv(await readInput(input))) {
  const overall = num(row, 'overall', 'overall_rating', 'OVR', 'Overall');
  if (!Number.isFinite(overall) || overall < threshold) continue;

  const rawPosition = clean(get(row, 'position', 'primary_position', 'POS', 'Position'));
  const position = normalizePosition(rawPosition);
  const name = clean(get(row, 'name', 'short_name', 'PLAYER', 'Player'));
  const id = clean(get(row, 'id', 'player_id', 'PLAYER_ID', 'Player ID')) ||
    `fc27-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

  if (!name || !positions.has(position)) throw new Error(`Invalid player row: ${name || '[unnamed]'}`);
  if (ids.has(id)) throw new Error(`Duplicate player id: ${id}`);
  ids.add(id);

  const attributes = position === 'GK'
    ? {
        pac: num(row, 'goalkeeping_diving', 'DIV', 'diving'),
        sho: num(row, 'goalkeeping_handling', 'HAN', 'handling'),
        pas: num(row, 'goalkeeping_kicking', 'KIC', 'kicking'),
        dri: num(row, 'goalkeeping_reflexes', 'REF', 'reflexes'),
        def: num(row, 'goalkeeping_speed', 'SPD', 'speed'),
        phy: num(row, 'goalkeeping_positioning', 'positioning'),
      }
    : {
        pac: num(row, 'pace', 'PAC'),
        sho: num(row, 'shooting', 'SHO'),
        pas: num(row, 'passing', 'PAS'),
        dri: num(row, 'dribbling', 'DRI'),
        def: num(row, 'defending', 'DEF'),
        phy: num(row, 'physicality', 'PHY', 'physical'),
      };

  if (Object.values(attributes).some(value => !Number.isFinite(value) || value < 0 || value > 99)) {
    throw new Error(`Invalid attributes for ${name}`);
  }

  const alternatePositions = get(row, 'alternate_positions', 'alternatePositions', 'ALT_POS', 'Alt Positions')
    .split(/[|;/ ]+/)
    .map(position => normalizePosition(position))
    .filter(position => positions.has(position) && position !== normalizePosition(rawPosition));

  const marketValue = num(row, 'market_value_m', 'marketValue', 'value_m', 'Value');
  const startingPrice = num(row, 'starting_price_m', 'startingPrice', 'auction_start_m');

  const player = {
    id, name,
    club: clean(get(row, 'club', 'club_name', 'TEAM', 'Team')),
    league: clean(get(row, 'league', 'league_name', 'League')),
    nationality: clean(get(row, 'nationality', 'nationality_name', 'NAT', 'Nation')),
    position,
    category: category(position),
    overall,
    attributes,
    age: num(row, 'age', 'Age'),
    preferredFoot: get(row, 'preferred_foot', 'preferredFoot', 'Foot') === 'Left' ? 'Left' : 'Right',
    alternatePositions: [...new Set(alternatePositions)],
    marketValue: Number.isFinite(marketValue) ? marketValue : 0,
    startingPrice: Number.isFinite(startingPrice) ? startingPrice : Math.max(1, Math.round((overall - 70) * 1.5)),
    valueSource: clean(get(row, 'market_value_source', 'valueSource')) || (remoteInput ? 'FC27 public ratings snapshot; auction value derived from OVR' : 'Authorized FC27 import'),
    valueVersion: clean(get(row, 'market_value_version', 'valueVersion')) || 'FC27-2026-09',
    updatedAt: clean(get(row, 'updated_at', 'updatedAt')) || new Date().toISOString(),
  };

  players.push(JSON.stringify(player));
}

const output = path.resolve('src/data/fc27.generated.ts');
fs.writeFileSync(output, `import type { Player } from '../types/football';

export const FC27_IMPORTED_PLAYERS: Player[] = [
  ${players.join(',\n  ')}
];
`);

console.log(`Imported ${players.length} FC27 players with OVR >= ${threshold} into ${output}`);
