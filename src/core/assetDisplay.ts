import type { Asset, Catalog } from './types.ts';

export const isScenarioAsset = (asset: Asset) =>
  /(?:^|[/\\ _-])(?:scenario\d*|campaign\d*)(?=$|[/\\ _-])/i.test(
    `${asset.internal ?? ''} ${asset.template} ${asset.source ?? ''} ${asset.name}`,
  );
export const isInternalPool = (asset: Asset) =>
  asset.kind === 'pool' ||
  /(?:Asset|Reward|Target|ItemEffectTarget)Pool/.test(asset.template);

export function displayAssetName(asset: Asset, catalog: Catalog): string {
  if (!isInternalPool(asset)) return asset.name || `未命名资源 ${asset.guid}`;
  const target = asset.template === 'ItemEffectTargetPool';
  const names = (asset.members ?? [])
    .map((g) => catalog.assets.find((a) => a.guid === g))
    .filter((a): a is Asset => !!a && !isInternalPool(a))
    .slice(0, 3)
    .map((a) => a.name);
  return `${target ? '适用建筑组合' : '内部资源组合'}${names.length ? `：${names.join('、')}${(asset.members?.length ?? 0) > names.length ? '等' : ''}` : `（${asset.guid}）`}`;
}
