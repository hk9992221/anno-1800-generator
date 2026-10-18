import type { Asset, Catalog, NativeFile, Population } from './types.ts';
import { at, children, descendants, numberAt, parseXml, value } from './xml.ts';
import starter from '../data/starter-assets.json' with { type: 'json' };
export const WORLD_NAMES: Record<string, string> = {
  Moderate: '旧世界 / 崔老妮海角',
  Colony01: '新世界',
  Arctic: '北极',
  Africa: '安贝沙',
};
export const worldName = (r?: string) => WORLD_NAMES[r ?? ''] || r || '未标明地区';
export const starterCatalog: Catalog = {
  version: 'Anno 1800 / Starter references',
  source: '内置资源参考；选择游戏根目录可识别全部本机资源、头像与已安装 Mod',
  fingerprint: 'starter-v2',
  indexedAt: '',
  assets: starter as Asset[],
};
export const catalogOf = (catalog?: Catalog) => catalog ?? starterCatalog;
export const lookupAsset = (catalog: Catalog | undefined, guid: number) =>
  catalogOf(catalog).assets.find((a) => a.guid === guid);
export const assetName = (catalog: Catalog | undefined, guid: number) =>
  lookupAsset(catalog, guid)?.name || `GUID ${guid || '未选择'}`;
export const decodeText = (base64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
export const encodeText = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
};
export const normalizePath = (path: string) =>
  path.replaceAll('\\', '/').replace(/^\.\//, '');
export function completeCatalog(catalog: Catalog): Catalog {
  const all = new Map(catalog.assets.map((a) => [a.guid, a]));
  const done = new Map<number, Asset>();
  const resolve = (g: number, visiting = new Set<number>()): Asset | undefined => {
    if (done.has(g)) return done.get(g);
    const a = all.get(g);
    if (!a || visiting.has(g)) return a;
    visiting.add(g);
    const parent = a.baseGuid ? resolve(a.baseGuid, visiting) : undefined;
    const merged: Asset = {
      ...parent,
      ...Object.fromEntries(
        Object.entries(a).filter(([, v]) => v !== undefined && v !== ''),
      ),
      guid: g,
      capabilities: [
        ...new Set([...(parent?.capabilities ?? []), ...(a.capabilities ?? [])]),
      ],
      traderStages: [
        ...new Map(
          [...(parent?.traderStages ?? []), ...(a.traderStages ?? [])].map((s) => [
            s.stage,
            s,
          ]),
        ).values(),
      ],
    } as Asset;
    const t = merged.template ?? '',
      caps = merged.capabilities ?? [],
      has = (n: string) => caps.includes(n);
    merged.kind =
      has('Item') || t === 'Portrait'
        ? 'portrait'
        : t === 'Product' || t === 'Product_Ammunition' || has('Product')
          ? /workforce/i.test(`${merged.english} ${merged.name} ${merged.internal ?? ''}`)
            ? 'workforce'
            : 'product'
          : has('PopulationLevel7') || t === 'PopulationLevel7'
            ? 'population'
            : has('Residence7') || /Residence/.test(t)
              ? 'residence'
              : has('Factory') ||
                  /Factory|Farm|Mine|Fishery|Multifactory|ProductionBuilding/.test(t)
                ? 'building'
                : /Ship|Airship|AirShip/.test(t)
                  ? 'ship'
                  : has('RewardPool') ||
                      has('AssetPool') ||
                      has('ItemEffectTargetPool') ||
                      /RewardPool|AssetPool|ItemEffectTargetPool/.test(t)
                    ? 'pool'
                    : t === 'Expedition' || has('Expedition')
                      ? 'expedition'
                      : t === 'ExpeditionEvent'
                        ? 'event'
                        : /^A7_Quest/.test(t)
                          ? 'quest'
                          : has('Profile') || has('Trader') || has('ConstructionAI')
                            ? 'profile'
                            : 'other';
    visiting.delete(g);
    done.set(g, merged);
    return merged;
  };
  for (const a of all.values()) resolve(a.guid);
  const assets = [...done.values()];
  const populations: Population[] = assets
    .filter((a) => a.kind === 'population')
    .map((a) => ({
      guid: a.guid,
      name: a.name,
      region:
        a.region ||
        assets.find((r) => r.kind === 'residence' && r.populationLevel === a.guid)
          ?.region ||
        '',
      needs: a.needs ?? [],
      residences: [
        ...new Set(
          assets
            .filter((r) => r.kind === 'residence' && r.populationLevel === a.guid)
            .map((r) => r.guid)
            .concat(a.defaultResidence ? [a.defaultResidence] : []),
        ),
      ],
    }));
  for (const a of assets)
    a.needFor = populations.filter((p) => p.needs.includes(a.guid)).map((p) => p.guid);
  return {
    ...catalog,
    assets,
    populations,
    traders: assets
      .filter((a) => a.traderStages?.length)
      .map((a) => ({ guid: a.guid, name: a.name, stages: a.traderStages! })),
  };
}
export const populationOf = (catalog?: Catalog) => catalogOf(catalog).populations ?? [];
export const populationTargets = (catalog: Catalog | undefined, levels: number[]) => [
  ...new Set(
    populationOf(catalog)
      .filter((p) => levels.includes(p.guid))
      .flatMap((p) => p.residences),
  ),
];
export const needsForLevels = (catalog: Catalog | undefined, levels: number[]) => [
  ...new Set(
    populationOf(catalog)
      .filter((p) => levels.includes(p.guid))
      .flatMap((p) => p.needs),
  ),
];
export function indexFiles(files: NativeFile[], source = '本机资源'): Catalog {
  const texts = new Map<number, string>();
  const docs = files
    .filter((f) => /\.xml$/i.test(f.path))
    .map((f) => ({
      path: normalizePath(f.path),
      doc: parseXml(decodeText(f.data)),
    }));
  for (const f of docs.filter((f) => /texts_chinese\.xml$/i.test(f.path)))
    for (const n of descendants(f.doc, 'Text')) {
      const g = numberAt(n, 'GUID');
      if (g) texts.set(g, value(n, 'Text'));
    }
  const assets: Asset[] = [];
  for (const f of docs.filter((f) => !/texts_/i.test(f.path)))
    for (const a of descendants(f.doc, 'Asset')) {
      const v = at(a, 'Values'),
        guid = numberAt(v, 'Standard/GUID');
      if (!guid) continue;
      const english = value(v, 'Text/LocaText/English/Text') || value(v, 'Standard/Name');
      const capabilities = (v?.children ?? []).map((n) => n.name);
      const getList = (path: string, key: string) =>
        children(at(v, path), 'Item')
          .map((n) => numberAt(n, key))
          .filter(Boolean);
      const traderStages = [
        'EarlyGame',
        'EarlyMidGame',
        'MidGame',
        'LateMidGame',
        'LateGame',
        'EndGame',
      ]
        .map((stage) => ({
          stage,
          poolGuid:
            numberAt(v, `Trader/Progression/${stage}/OfferingItems`) ||
            numberAt(v, `ConstructionAI/ItemTradeConfig/ItemPools/${stage}/Pool`),
        }))
        .filter((s) => s.poolGuid > 0);
      assets.push({
        guid,
        internal: value(v, 'Standard/Name'),
        name: texts.get(guid) || english,
        english,
        template: value(a, 'Template'),
        kind: 'other',
        baseGuid: numberAt(a, 'BaseAssetGUID') || undefined,
        icon: value(v, 'Standard/IconFilename') || undefined,
        region:
          value(v, 'Building/AssociatedRegions') ||
          value(v, 'PopulationLevel7/AssociatedRegion') ||
          undefined,
        source,
        capabilities,
        inputs: at(v, 'Factory/FactoryInputs')
          ? getList('Factory/FactoryInputs', 'Product')
          : undefined,
        populationLevel: numberAt(v, 'Residence7/PopulationLevel7') || undefined,
        needs: at(v, 'PopulationLevel7/PopulationInputs')
          ? getList('PopulationLevel7/PopulationInputs', 'Product')
          : undefined,
        defaultResidence: numberAt(v, 'PopulationLevel7/DefaultResidence') || undefined,
        traderStages,
        slotRegion: value(v, 'ExpeditionSlot/SlotRegion') || undefined,
        expeditionRegion: value(v, 'Expedition/ExpeditionRegion') || undefined,
        members: descendants(
          at(v, 'ItemEffectTargetPool') ??
            at(v, 'RewardPool') ??
            at(v, 'AssetPool') ?? { ...f.doc, children: [] },
          'Item',
        )
          .map(
            (n) => numberAt(n, 'GUID') || numberAt(n, 'ItemLink') || numberAt(n, 'Asset'),
          )
          .filter(Boolean),
        poolPath: at(v, 'RewardPool')
          ? 'RewardPool/ItemsPool'
          : at(v, 'AssetPool')
            ? 'AssetPool/AssetList'
            : undefined,
      });
    }
  if (!assets.length)
    throw new Error('没有找到含 Standard/GUID 的资源定义，请选择游戏根目录');
  return completeCatalog({
    version: '本机 Anno 1800 资源',
    source,
    fingerprint: `${assets.length}:${files.reduce((n, f) => n + f.data.length, 0)}`,
    indexedAt: new Date().toISOString(),
    assets,
    indexVersion: 2,
  });
}
export function expandTargets(catalog: Catalog, guids: number[]): number[] {
  const all = new Map(catalog.assets.map((a) => [a.guid, a])),
    out = new Set<number>(),
    visiting = new Set<number>();
  const walk = (g: number) => {
    if (visiting.has(g)) throw new Error(`目标池循环引用：${g}`);
    const a = all.get(g);
    if (a?.template === 'ItemEffectTargetPool' && a.members?.length) {
      visiting.add(g);
      a.members.forEach(walk);
      visiting.delete(g);
    } else out.add(g);
  };
  guids.forEach(walk);
  return [...out];
}
