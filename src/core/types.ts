export type Allocation =
  | 'GuildHouse'
  | 'HarborOffice'
  | 'Lodge'
  | 'TownHall'
  | 'Ship'
  | 'SailShip'
  | 'SteamShip'
  | 'Warship'
  | 'Tradeship'
  | 'AirShip';
export type Family = 'production' | 'residence' | 'ship';
export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
export interface Effect {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}
export interface Source {
  id: string;
  type: 'trader' | 'gallery' | 'research' | 'expedition' | 'visitor' | 'quest' | 'craft';
  label: string;
  poolGuid: number;
  weight: number;
  tickets: number;
  maxCount: number;
  scale: number;
  traderGuid?: number;
  stage?: string;
  automation?: Acquisition;
}
export interface RuleCondition {
  id: string;
  type: 'population' | 'building' | 'stock' | 'time' | 'unlocked';
  guid: number;
  amount: number;
}
export interface Acquisition {
  ids: Record<string, number>;
  title: string;
  story: string;
  conditions: RuleCondition[];
  rewardAmount: number;
  sessionGuid: number;
  giverGuid: number;
  cooldownMinutes: number;
  maxRuns: number;
  objective: {
    type: 'stock' | 'building' | 'population' | 'time';
    guid: number;
    amount: number;
    seconds: number;
  };
  expedition: {
    baseGuid: number;
    slotGuid: number;
    region: string;
    difficulty: string;
    category: string;
    eventTitle: string;
    eventText: string;
    optionText: string;
    requiredProduct: number;
    requiredAmount: number;
  };
}
export interface Population {
  guid: number;
  name: string;
  region: string;
  residences: number[];
  needs: number[];
}
export interface CardImage {
  mode: 'game' | 'custom';
  path: string;
  data?: string;
  original?: string;
  crop?: { x: number; y: number; zoom: number };
}
export interface CardOrigin {
  file: string;
  raw: string;
  baseline: string;
  nameGuid: number;
  unsupported: string[];
}
export interface Card {
  id: string;
  guid: number;
  descriptionGuid: number;
  galleryPermitGuid: number;
  galleryPackageGuid: number;
  name: string;
  english: string;
  subtitle: string;
  description: string;
  englishDescription: string;
  rarity: Rarity;
  allocation: Allocation;
  itemType: 'Specialist' | 'Normal';
  price: number;
  stack: number;
  group: string;
  notes: string;
  status: 'draft' | 'active' | 'retired';
  published: boolean;
  image: CardImage;
  targets: number[];
  populationLevels?: number[];
  effects: Effect[];
  sources: Source[];
  origin?: CardOrigin;
}
export interface ResourceFile {
  path: string;
  data: string;
}
export interface Asset {
  guid: number;
  name: string;
  english: string;
  internal?: string;
  template: string;
  kind:
    | 'building'
    | 'product'
    | 'workforce'
    | 'pool'
    | 'portrait'
    | 'ship'
    | 'residence'
    | 'population'
    | 'expedition'
    | 'event'
    | 'quest'
    | 'profile'
    | 'other';
  icon?: string;
  region?: string;
  outputs?: number[];
  nameGuid?: number;
  lineId?: number;
  localizedName?: boolean;
  trader?: boolean;
  traderLabel?: string;
  dlc?: string;
  source?: string;
  projectId?: string;
  members?: number[];
  inputs?: number[];
  allocations?: Allocation[];
  capabilities?: string[];
  raw?: string;
  baseGuid?: number;
  populationLevel?: number;
  needs?: number[];
  needFor?: number[];
  defaultResidence?: number;
  traderStages?: { stage: string; poolGuid: number }[];
  slotRegion?: string;
  expeditionRegion?: string;
  poolPath?: string;
  owner?: string;
  stage?: string;
}
export interface Trader {
  guid: number;
  name: string;
  regions?: string[];
  reference?: boolean;
  stages: { stage: string; poolGuid: number }[];
}
export interface Catalog {
  version: string;
  source: string;
  fingerprint: string;
  assets: Asset[];
  indexedAt: string;
  scanReport?: {
    status: 'complete' | 'partial';
    archiveCount: number;
    archivesRead: number;
    archives: {
      path: string;
      status: 'read' | 'failed';
      entries: number;
      message?: string;
    }[];
    files: {
      path: string;
      source: string;
      kind: 'assets' | 'chinese';
      status: 'read' | 'failed' | 'skipped';
      count: number;
      message?: string;
    }[];
    chineseTexts: number;
  };
  scannedModGuids?: number[];
  traders?: Trader[];
  populations?: Population[];
  portraits?: string[];
  gameRoot?: string;
  modRoots?: string[];
  modCount?: number;
  warnings?: string[];
  indexVersion?: number;
}
export interface Project {
  schemaVersion: 1;
  projectId: string;
  name: string;
  modId: string;
  folderName: string;
  zipName: string;
  version: string;
  guidRange: { start: number; end: number; next: number };
  reservedGuids: number[];
  cards: Card[];
  dependencies: string[];
  dlcs: string[];
  mode: 'collection' | 'edit';
  importedFiles: ResourceFile[];
  removedCards?: { guid: number; guids: number[]; file?: string }[];
  catalog?: Catalog;
  createdAt: string;
}
export interface Issue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  cardId?: string;
  effectId?: string;
}
export interface ExportFile {
  path: string;
  data: string;
}
export interface ExportPlan {
  projectId: string;
  modId: string;
  folderName: string;
  files: ExportFile[];
  cardGuids: number[];
}
export interface NativeFile {
  path: string;
  data: string;
}
export const ALLOCATIONS: Record<Allocation, string> = {
  GuildHouse: '工会',
  HarborOffice: '港务办公室',
  Lodge: '北极小屋',
  TownHall: '市政厅',
  Ship: '所有船舶',
  SailShip: '帆船',
  SteamShip: '蒸汽船',
  Warship: '战舰',
  Tradeship: '贸易船',
  AirShip: '飞艇',
};
export const RARITIES: Record<Rarity, string> = {
  Common: '普通',
  Uncommon: '非凡',
  Rare: '稀有',
  Epic: '史诗',
  Legendary: '传奇',
};
export const familyOf = (a: Allocation): Family =>
  a === 'TownHall'
    ? 'residence'
    : (['GuildHouse', 'HarborOffice', 'Lodge'] as string[]).includes(a)
      ? 'production'
      : 'ship';
let sequence = 0;
export function uid(): string {
  const d = new Date(),
    pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${stamp}-${pad(++sequence, 6)}-${[...random].map((n) => n.toString(16).padStart(8, '0')).join('')}`;
}
export const cardSnapshot = (card: Card) =>
  JSON.stringify({ ...card, origin: undefined, published: undefined });
