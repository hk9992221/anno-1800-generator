export const WORLD_NAMES: Record<string, string> = {
  Moderate: '旧世界／崔老妮海角',
  Colony01: '新世界',
  Arctic: '北极',
  Africa: '安贝沙',
};
const ALIASES: Record<string, string> = {
  moderate: 'Moderate',
  oldworld: 'Moderate',
  旧世界: 'Moderate',
  capetrelawney: 'Moderate',
  崔老妮海角: 'Moderate',
  '5000000': 'Moderate',
  colony01: 'Colony01',
  newworld: 'Colony01',
  southamerica: 'Colony01',
  新世界: 'Colony01',
  '5000001': 'Colony01',
  arctic: 'Arctic',
  北极: 'Arctic',
  '160001': 'Arctic',
  africa: 'Africa',
  enbesa: 'Africa',
  安贝沙: 'Africa',
  '114327': 'Africa',
};
export function normalizeRegions(input?: string | string[] | number): string[] {
  const tokens = (Array.isArray(input) ? input : [input ?? '']).flatMap((s) =>
    String(s).split(/[;,，、|\s]+/),
  );
  return [
    ...new Set(
      tokens
        .filter((s) => s && !['meta', 'none', '0'].includes(s.toLowerCase()))
        .map((s) => ALIASES[s.toLowerCase()] ?? s),
    ),
  ];
}
export const worldName = (value?: string | string[]) =>
  normalizeRegions(value)
    .map((r) => WORLD_NAMES[r] ?? `未确认地区（${r}）`)
    .join('、') || '地区未确认';
