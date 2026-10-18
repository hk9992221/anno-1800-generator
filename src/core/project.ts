import type { Card, Catalog, Project, Source } from './types.ts';
import { cardSnapshot, uid } from './types.ts';
export const PRIVATE_START = 2001000000,
  PRIVATE_END = 2001009999;
export function createProject(): Project {
  return {
    schemaVersion: 1,
    projectId: uid(),
    name: '我的自定义卡牌',
    modId: 'anno1800-cardforge-custom-cards',
    folderName: '[Gameplay] Anno1800 Custom Cards',
    zipName: 'Anno1800-Custom-Cards.zip',
    version: '1.0.0',
    guidRange: { start: PRIVATE_START, end: PRIVATE_END, next: PRIVATE_START },
    reservedGuids: [],
    cards: [],
    dependencies: [],
    dlcs: [],
    mode: 'collection',
    importedFiles: [],
    createdAt: new Date().toISOString(),
  };
}
export function allocate(p: Project, count: number, seed = uid()): number[] {
  const { start, end } = p.guidRange;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1337471142 ||
    end > 2147483647 ||
    end < start
  )
    throw new Error('GUID 范围必须在游戏允许的 Mod 整数范围内');
  const used = new Set([
    ...p.reservedGuids,
    ...p.cards.flatMap((c) => [
      c.guid,
      c.descriptionGuid,
      c.galleryPermitGuid,
      c.galleryPackageGuid,
    ]),
    ...(p.catalog?.assets.map((a) => a.guid) ?? []),
    ...(p.catalog?.scannedModGuids ?? []),
  ]);
  let hash = 2166136261;
  for (const ch of seed) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const width = end - start + 1,
    result: number[] = [];
  let offset = hash % width,
    examined = 0;
  while (result.length < count) {
    if (examined++ >= width) throw new Error('GUID 范围不足，请在工程设置中检查范围');
    const next = start + offset;
    offset = (offset + 1) % width;
    if (!used.has(next)) {
      result.push(next);
      used.add(next);
    }
  }
  p.guidRange.next = start + offset;
  p.reservedGuids = [...new Set([...p.reservedGuids, ...result])];
  return result;
}
export function createCard(p: Project, name = '未命名专家'): Card {
  const id = uid();
  const [guid, descriptionGuid, galleryPermitGuid, galleryPackageGuid] = allocate(
    p,
    4,
    id,
  );
  return {
    id,
    guid,
    descriptionGuid,
    galleryPermitGuid,
    galleryPackageGuid,
    name,
    english: '',
    subtitle: '',
    description: '',
    englishDescription: '',
    rarity: 'Epic',
    allocation: 'GuildHouse',
    itemType: 'Specialist',
    price: 150000,
    stack: 1,
    group: '我的卡牌',
    notes: '',
    status: 'active',
    published: false,
    image: {
      mode: 'game',
      path: 'data/ui/2kimages/main/3dicons/specialists/systemic/icon_farmer_403.png',
    },
    targets: [],
    effects: [],
    sources: [],
  };
}
export function cloneCard(p: Project, card: Card, name = `${card.name} · 副本`): Card {
  if (card.origin?.unsupported.length)
    throw new Error(
      '这张外部卡牌含未知字段，请先使用原 Mod 副本模式，避免复制后留下错误的内部引用',
    );
  const next = createCard(p, name);
  return {
    ...structuredClone(card),
    ...Object.fromEntries(
      ['id', 'guid', 'descriptionGuid', 'galleryPermitGuid', 'galleryPackageGuid'].map(
        (k) => [k, next[k as keyof Card]],
      ),
    ),
    name,
    published: false,
    origin: undefined,
    effects: card.effects.map((e) => ({ ...structuredClone(e), id: uid() })),
    sources: card.sources.map((s) => {
      const copy = structuredClone(s);
      copy.id = uid();
      if (copy.automation) {
        const keys = Object.keys(copy.automation.ids);
        const ids = allocate(p, keys.length);
        copy.automation.ids = Object.fromEntries(keys.map((k, i) => [k, ids[i]]));
      }
      return copy;
    }),
  } as Card;
}
export function parseProject(input: string): Project {
  const p = JSON.parse(input) as Project;
  if (p.schemaVersion !== 1)
    throw new Error('不支持此工程版本，请使用更新版本的卡牌工坊');
  if (
    !p.projectId ||
    !Array.isArray(p.cards) ||
    !p.guidRange ||
    !Array.isArray(p.reservedGuids) ||
    !p.modId ||
    !p.folderName ||
    !Array.isArray(p.importedFiles) ||
    p.cards.length > 10000
  )
    throw new Error('工程文件结构不完整');
  for (const c of p.cards) {
    if (
      !c.id ||
      !Number.isInteger(c.guid) ||
      !Array.isArray(c.effects) ||
      !Array.isArray(c.targets) ||
      !Array.isArray(c.sources) ||
      !c.image
    )
      throw new Error('卡牌数据不完整');
  }
  return p;
}
export const adoptCatalog = (p: Project, c: Catalog): Project => ({
  ...p,
  catalog: c,
});
export function baselineCard(c: Card) {
  if (c.origin) c.origin.baseline = cardSnapshot(c);
}

export function createSource(p: Project, type: Source['type']): Source {
  const names = {
    gallery: '壮丽艺廊',
    trader: '商人购买',
    research: '研究所',
    expedition: '远征事件',
    visitor: '访客',
    quest: '任务奖励',
    craft: '制作',
  };
  const s: Source = {
    id: uid(),
    type,
    label: names[type],
    poolGuid: 0,
    weight: 100,
    tickets: 100,
    maxCount: 99,
    scale: 1.5,
  };
  if (type === 'trader') {
    const t = p.catalog?.traders?.[0],
      stage = t?.stages[0];
    if (t && stage)
      Object.assign(s, {
        label: t.name,
        traderGuid: t.guid,
        stage: stage.stage,
        poolGuid: stage.poolGuid,
      });
  }
  if (type === 'quest' || type === 'expedition') {
    const keys =
      type === 'quest'
        ? ['quest', 'pool', 'story']
        : [
            'mission',
            'trigger',
            'event',
            'decision',
            'option',
            'success',
            'skipOption',
            'skipDecision',
            'reward',
            'story',
          ];
    const ids = allocate(p, keys.length);
    const base =
      p.catalog?.assets.find((a) => a.guid === 800413) ||
      p.catalog?.assets.find((a) => a.kind === 'expedition');
    const region = base?.expeditionRegion || 'NorthernEurope';
    s.automation = {
      ids: Object.fromEntries(keys.map((k, i) => [k, ids[i]])),
      title: type === 'quest' ? '居民的委托' : '专家寻访之旅',
      story: '完成委托，获得这张卡牌。',
      conditions: [],
      rewardAmount: 1,
      sessionGuid: 180023,
      giverGuid: 86,
      cooldownMinutes: 30,
      maxRuns: 1,
      objective: { type: 'stock', guid: 120008, amount: 20, seconds: 30 },
      expedition: {
        baseGuid: base?.guid || 800413,
        slotGuid:
          p.catalog?.assets.find(
            (a) => a.template === 'ExpeditionSlot' && a.slotRegion === region,
          )?.guid || 0,
        region,
        difficulty: 'Average',
        category: 'RescueMission',
        eventTitle: '意外的相遇',
        eventText: '一位专家希望搭乘你的船只。',
        optionText: '邀请专家同行',
        requiredProduct: 0,
        requiredAmount: 1,
      },
    };
  }
  return s;
}
export function deleteCard(p: Project, id: string) {
  const c = p.cards.find((c) => c.id === id);
  if (!c) return;
  const guids = [
    ...(c.origin?.nameGuid ? [c.origin.nameGuid] : []),
    c.guid,
    c.descriptionGuid,
    c.galleryPermitGuid,
    c.galleryPackageGuid,
    ...c.sources.flatMap((s) => Object.values(s.automation?.ids ?? {})),
  ];
  p.removedCards = [
    ...(p.removedCards ?? []),
    { guid: c.guid, guids, file: c.origin?.file },
  ];
  p.cards = p.cards.filter((c) => c.id !== id);
}
