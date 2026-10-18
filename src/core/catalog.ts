import type { Asset, Catalog, NativeFile, Population } from './types.ts';
import { at, children, descendants, numberAt, parseXml, value } from './xml.ts';
import starter from '../data/starter-assets.json' with { type: 'json' };
import { normalizeRegions } from './regions.ts';
export { WORLD_NAMES, worldName, normalizeRegions } from './regions.ts';
const referenceByGuid = new Map((starter as Asset[]).map((a) => [a.guid, a]));
const hasChinese = (s?: string) => /[\u3400-\u9fff]/u.test(s ?? '');
function referenceMetadata(a: Asset): Asset {
  const ref = referenceByGuid.get(a.guid);
  const out = { ...a };
  if (ref) {
    if (!hasChinese(a.name) && hasChinese(ref.name)) out.name = ref.name;
    for (const key of [
      'region',
      'inputs',
      'outputs',
      'populationLevel',
      'needs',
      'trader',
    ] as const)
      if (out[key] === undefined && ref[key] !== undefined)
        Object.assign(out, { [key]: ref[key] });
    if (ref.traderLabel) out.traderLabel = ref.traderLabel;
  }
  if (out.region) out.region = normalizeRegions(out.region).join(';');
  return out;
}
const localizedCache = new WeakMap<Catalog, Catalog>();
function localizedCatalog(catalog: Catalog): Catalog {
  const cached = localizedCache.get(catalog);
  if (cached) return cached;
  const assets = catalog.assets.map(referenceMetadata);
  const result = {
    ...catalog,
    assets,
    populations: catalog.populations?.map((p) => ({
      ...p,
      name: assets.find((a) => a.guid === p.guid)?.name ?? p.name,
      region: normalizeRegions(p.region).join(';'),
    })),
    traders: catalog.traders?.map((t) => {
      const ref = referenceByGuid.get(t.guid);
      return {
        ...t,
        name: ref?.traderLabel ?? (hasChinese(t.name) ? t.name : (ref?.name ?? t.name)),
        regions: normalizeRegions(t.regions ?? ref?.region),
      };
    }),
  };
  localizedCache.set(catalog, result);
  return result;
}
export const starterCatalog: Catalog = completeCatalog({
  version: 'Anno 1800 / Starter references',
  source: '内置资源参考；选择游戏根目录可识别全部本机资源、头像与已安装 Mod',
  fingerprint: 'starter-zh-v3',
  indexedAt: '',
  assets: starter as Asset[],
});
export const catalogOf = (catalog?: Catalog) =>
  catalog ? localizedCatalog(catalog) : starterCatalog;
export const lookupAsset = (catalog: Catalog | undefined, guid: number) =>
  catalogOf(catalog).assets.find((a) => a.guid === guid);
export const assetName = (catalog: Catalog | undefined, guid: number) =>
  lookupAsset(catalog, guid)?.name || `GUID ${guid || '未选择'}`;
export const decodeText = (base64: string) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  let encoding = 'utf-8';
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 60 && bytes[1] === 0))
    encoding = 'utf-16le';
  else if (
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0 && bytes[1] === 60)
  )
    encoding = 'utf-16be';
  else {
    const prefix = String.fromCharCode(...bytes.subarray(0, 256));
    const label = prefix.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)?.[1];
    if (label) encoding = label;
  }
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    throw new Error(`不支持的文本编码：${encoding}`);
  }
};
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
    Object.assign(merged, referenceMetadata(merged));
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
                          : has('Profile') ||
                              has('Trader') ||
                              has('ConstructionAI') ||
                              /^Profile/.test(t)
                            ? 'profile'
                            : 'other';
    visiting.delete(g);
    done.set(g, merged);
    return merged;
  };
  for (const a of all.values()) resolve(a.guid);
  const assets = [...done.values()];
  const origins = new Map<number, Set<string>>();
  for (const a of assets.filter((a) => a.kind === 'building'))
    for (const g of a.outputs ?? []) {
      const set = origins.get(g) ?? new Set<string>();
      normalizeRegions(a.region).forEach((r) => set.add(r));
      origins.set(g, set);
    }
  for (const a of assets.filter((a) => a.kind === 'product'))
    if (origins.get(a.guid)?.size) a.region = [...origins.get(a.guid)!].join(';');
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
      .filter((a) => a.traderStages?.length || a.trader)
      .map((a) => ({
        guid: a.guid,
        name: a.traderLabel ?? a.name,
        stages: a.traderStages ?? [],
        regions: normalizeRegions(a.region),
        reference: !catalog.indexedAt,
      })),
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
        name:
          texts.get(guid) ||
          texts.get(numberAt(v, 'Standard/TextGUID')) ||
          texts.get(numberAt(v, 'Text/LineID')) ||
          english,
        nameGuid: numberAt(v, 'Standard/TextGUID') || guid,
        lineId: numberAt(v, 'Text/LineID') || guid,
        english,
        template: value(a, 'Template'),
        kind: 'other',
        baseGuid: numberAt(a, 'BaseAssetGUID') || undefined,
        icon: value(v, 'Standard/IconFilename') || undefined,
        region:
          value(v, 'Building/AssociatedRegions') ||
          value(v, 'PopulationLevel7/AssociatedRegion') ||
          value(v, 'ThirdParty/AllowedRegions') ||
          undefined,
        source,
        capabilities,
        inputs: at(v, 'Factory/FactoryInputs')
          ? getList('Factory/FactoryInputs', 'Product')
          : undefined,
        outputs: at(v, 'Factory/FactoryOutputs')
          ? getList('Factory/FactoryOutputs', 'Product')
          : undefined,
        populationLevel: numberAt(v, 'Residence7/PopulationLevel7') || undefined,
        needs: at(v, 'PopulationLevel7/PopulationInputs')
          ? getList('PopulationLevel7/PopulationInputs', 'Product')
          : undefined,
        defaultResidence: numberAt(v, 'PopulationLevel7/DefaultResidence') || undefined,
        traderStages,
        slotRegion: value(v, 'ExpeditionSlot/SlotRegion') || undefined,
        expeditionRegion: value(v, 'Expedition/ExpeditionRegion') || undefined,
        members:
          at(v, 'ItemEffectTargetPool') || at(v, 'RewardPool') || at(v, 'AssetPool')
            ? descendants(
                at(v, 'ItemEffectTargetPool') ??
                  at(v, 'RewardPool') ??
                  at(v, 'AssetPool') ?? { ...f.doc, children: [] },
                'Item',
              )
                .map(
                  (n) =>
                    numberAt(n, 'GUID') ||
                    numberAt(n, 'ItemLink') ||
                    numberAt(n, 'Asset'),
                )
                .filter(Boolean)
            : undefined,
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
    indexVersion: 3,
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
