import type { Issue, Project } from './types.ts';
import { familyOf } from './types.ts';
import { effectDef, needOutputs } from './effects.ts';
import { lookupAsset, populationOf } from './catalog.ts';
export function validateProject(p: Project): Issue[] {
  const out: Issue[] = [],
    add = (
      severity: Issue['severity'],
      code: string,
      message: string,
      cardId?: string,
      effectId?: string,
    ) => out.push({ severity, code, message, cardId, effectId });
  const validGuid = (n: number) => Number.isInteger(n) && n > 0 && n <= 2147483647;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/.test(p.modId))
    add('error', 'modId', 'ModID 只能使用字母、数字、点、横线和下划线');
  if (
    !p.folderName ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(p.folderName) ||
    /[. ]$/.test(p.folderName) ||
    p.folderName === '.' ||
    p.folderName === '..'
  )
    add('error', 'folder', 'Mod 文件夹名包含 Windows 不支持的字符');
  if (!p.cards.some((c) => c.status !== 'draft') && !p.removedCards?.length)
    add('error', 'empty', '至少需要一张参与导出的卡牌');
  const ids = new Map<number, string>(),
    cardIds = new Set<string>();
  for (const c of p.cards) {
    if (cardIds.has(c.id)) add('error', 'cardId', '工程卡牌 ID 重复', c.id);
    cardIds.add(c.id);
    for (const g of [
      c.guid,
      c.descriptionGuid,
      c.galleryPermitGuid,
      c.galleryPackageGuid,
      ...c.sources.flatMap((s) => Object.values(s.automation?.ids ?? {})),
    ]) {
      if (!validGuid(g))
        add('error', 'guid', '卡牌及辅助 GUID 必须是合法的游戏整数', c.id);
      if (ids.has(g)) add('error', 'duplicate', `GUID ${g} 与 ${ids.get(g)} 冲突`, c.id);
      else ids.set(g, c.name);
    }
    if (c.status === 'draft') continue;
    if (!c.name.trim()) add('error', 'name', '请填写卡牌名称', c.id);
    if (
      !Number.isInteger(c.price) ||
      c.price < 0 ||
      !Number.isInteger(c.stack) ||
      c.stack < 1
    )
      add('error', 'price', '购买价格必须是非负整数，堆叠数量必须是正整数', c.id);
    if (!c.targets.length && familyOf(c.allocation) !== 'ship')
      add('error', 'targets', '请至少选择一个适用目标', c.id);
    if (c.image.mode === 'custom' && !c.image.data)
      add('error', 'image', '上传图片的数据缺失', c.id);
    if (
      c.image.mode === 'game' &&
      (!c.image.path.startsWith('data/') || c.image.path.includes('..'))
    )
      add('error', 'imagePath', '原版头像必须引用 data/ 下的合法资源路径', c.id);
    if (c.status === 'active' && !c.sources.length)
      add('warning', 'sources', '尚未设置获取途径：卡牌可能无法在正常游戏中取得', c.id);
    const seen = new Set<string>(),
      replacements = new Map<number, number>(),
      outputs = new Set<number>();
    for (const e of c.effects.filter((e) => e.enabled)) {
      const d = effectDef(e.type);
      if (!d) {
        add('error', 'effect', `未知效果 ${e.type}`, c.id, e.id);
        continue;
      }
      if (!d.families.includes(familyOf(c.allocation)))
        add('error', 'family', `${d.label}不适用于当前安装位置`, c.id, e.id);
      if (!d.repeat && seen.has(d.id))
        add('error', 'duplicateEffect', `${d.label}重复，合并为一个积木`, c.id, e.id);
      seen.add(d.id);
      for (const param of d.params) {
        const v = e.params[param.key];
        if (param.kind === 'boolean') {
          if (typeof v !== 'boolean')
            add('error', 'parameter', `${param.label}必须是开关值`, c.id, e.id);
          continue;
        }
        if (param.multi) {
          if (
            !needOutputs(v).length ||
            String(v)
              .split(/[,，;\s]+/)
              .filter(Boolean)
              .some((x) => !validGuid(Number(x)))
          )
            add('error', 'resource', `请选择${param.label}`, c.id, e.id);
          continue;
        }
        const n = Number(v);
        if (!Number.isFinite(n) || !Number.isInteger(n))
          add('error', 'parameter', `${param.label}必须是整数`, c.id, e.id);
        else if (['product', 'workforce', 'need'].includes(param.kind) && !validGuid(n))
          add('error', 'resource', `请选择${param.label}`, c.id, e.id);
        else if (
          param.kind === 'number' &&
          (n < (param.min ?? -Infinity) ||
            n > (param.max ?? Infinity) ||
            (param.step && Math.abs(n / param.step - Math.round(n / param.step)) > 1e-8))
        )
          add(
            'error',
            'range',
            `${param.label}超出范围或不符合步长 ${param.step ?? 1}`,
            c.id,
            e.id,
          );
      }
      if (d.encoding === 'need') {
        const ys = needOutputs(e.params.substitute),
          x = Number(e.params.provided);
        if (ys.includes(x)) add('error', 'needSelf', 'X 与 Y 不能是同一需求', c.id, e.id);
        for (const pop of populationOf(p.catalog).filter((p) =>
          (c.populationLevels ?? []).includes(p.guid),
        )) {
          const missing = [x, ...ys].filter((g) => !pop.needs.includes(g));
          if (missing.length)
            add(
              'warning',
              'needClass',
              `${pop.name}没有部分所选需求；对应需求对这一阶级无效`,
              c.id,
              e.id,
            );
        }
      }
      if (d.encoding === 'replace') {
        const old = Number(e.params.old),
          n = Number(e.params.new);
        if (replacements.has(old) || old === n)
          add('error', 'replace', '同一原料重复替换，或新旧原料相同', c.id, e.id);
        replacements.set(old, n);
        for (const g of c.targets) {
          const a = lookupAsset(p.catalog, g);
          if (a?.inputs && !a.inputs.includes(old))
            add(
              'warning',
              'input',
              `${a.name}不使用被替换原料，此积木对它无效`,
              c.id,
              e.id,
            );
        }
      }
      if (d.encoding === 'output') {
        const g = Number(e.params.product);
        if (outputs.has(g))
          add(
            'error',
            'output',
            '同一种额外商品配置了多个周期，请合并为一条明确规则',
            c.id,
            e.id,
          );
        outputs.add(g);
      }
    }
    for (const n of replacements.values())
      if (replacements.has(n))
        add('error', 'replaceChain', '原料替换链／闭环存在歧义，请拆分规则', c.id);
    if (
      c.effects.some((e) => e.enabled && e.type === 'whiteFlag' && e.params.value) &&
      c.effects.some((e) => e.enabled && e.type === 'pirateFlag' && e.params.value)
    )
      add('error', 'flags', '白旗和海盗旗不能同时启用', c.id);
    const pools = new Set<number>();
    let gallery = 0;
    for (const s of c.sources) {
      if (s.type === 'quest' || s.type === 'expedition') {
        const a = s.automation;
        if (!a) {
          add('error', 'acquisition', '请重新添加该渠道并填写任务／事件内容', c.id);
          continue;
        }
        if (
          !a.title.trim() ||
          !a.story.trim() ||
          !Number.isInteger(a.rewardAmount) ||
          a.rewardAmount < 1 ||
          a.rewardAmount > 99
        )
          add('error', 'acquisition', '请填写任务名称、内容及 1–99 张奖励数量', c.id);
        for (const r of a.conditions)
          if (
            !Number.isInteger(r.amount) ||
            r.amount < 0 ||
            (r.type !== 'time' && !validGuid(r.guid))
          )
            add('error', 'trigger', '请补全所有触发条件', c.id);
        if (s.type === 'quest') {
          const o = a.objective;
          if (
            !validGuid(a.sessionGuid) ||
            !validGuid(a.giverGuid) ||
            !Number.isInteger(a.maxRuns) ||
            a.maxRuns < 1 ||
            !Number.isInteger(a.cooldownMinutes) ||
            a.cooldownMinutes < 0 ||
            a.cooldownMinutes > 1440
          )
            add(
              'error',
              'quest',
              '请补全任务地区、发布人、重复次数及 0–1440 分钟冷却时间',
              c.id,
            );
          if (
            (o.type !== 'time' &&
              (!validGuid(o.guid) || !Number.isInteger(o.amount) || o.amount < 1)) ||
            !Number.isInteger(o.seconds) ||
            o.seconds < 1 ||
            o.seconds > 86400
          )
            add('error', 'objective', '请填写任务目标、数量及 1–86400 秒保持时间', c.id);
        } else {
          const x = a.expedition;
          if (
            !validGuid(x.baseGuid) ||
            !validGuid(x.slotGuid) ||
            !x.eventTitle.trim() ||
            !x.eventText.trim() ||
            !x.optionText.trim()
          )
            add('error', 'expedition', '请补全远征模板、地区槽、事件和选项', c.id);
          if (
            x.requiredProduct &&
            (!validGuid(x.requiredProduct) ||
              !Number.isInteger(x.requiredAmount) ||
              x.requiredAmount < 1)
          )
            add('error', 'expeditionGoods', '请设置选项所需物资与正整数数量', c.id);
        }
        continue;
      }
      if (s.type === 'gallery') {
        gallery++;
        if (
          !Number.isInteger(s.tickets) ||
          s.tickets < 1 ||
          !Number.isInteger(s.maxCount) ||
          s.maxCount < 1 ||
          s.maxCount > 99 ||
          !Number.isFinite(s.scale) ||
          s.scale < 1
        )
          add(
            'error',
            'gallery',
            '艺廊价格至少 1 金票，购买上限 1–99，价格倍率至少 1',
            c.id,
          );
      } else {
        if (!validGuid(s.poolGuid))
          add('error', 'pool', `请为${s.label}选择正确的获取物品池`, c.id);
        if (s.type === 'trader' && s.traderGuid) {
          const trader = p.catalog?.traders?.find((t) => t.guid === s.traderGuid),
            stage = trader?.stages.find((st) => st.stage === s.stage);
          if (trader && stage?.poolGuid !== s.poolGuid)
            add(
              'error',
              'traderPool',
              '商人、解锁阶段与物品池不一致，请重新选择阶段',
              c.id,
            );
          if (!trader)
            add(
              'warning',
              'unknownTrader',
              '当前索引未确认该商人，请重新读取资源核对渠道',
              c.id,
            );
        }
        const a = lookupAsset(p.catalog, s.poolGuid);
        if (a && !a.poolPath)
          add('error', 'poolType', `${a.name}不是支持的奖励／物品资产池`, c.id);
        if (!a)
          add(
            'warning',
            'unknownPool',
            `获取池 ${s.poolGuid} 未在本机索引中确认，请核对池类型和 NPC 路径`,
            c.id,
          );
        if (pools.has(s.poolGuid))
          add('error', 'poolDuplicate', '同一卡牌重复添加了相同获取池', c.id);
        pools.add(s.poolGuid);
        if (!Number.isInteger(s.weight) || s.weight < 1 || s.weight > 1000000)
          add('error', 'weight', '池内相对权重请输入 1–1,000,000 的整数', c.id);
        if (s.type === 'craft')
          add('error', 'craft', '制作途径需要完整配方，不能当作普通物品池上架', c.id);
      }
    }
    if (gallery > 1)
      add('error', 'galleryDuplicate', '同一卡牌只应创建一个艺廊条目', c.id);
    if (c.origin?.unsupported.length && p.mode === 'collection')
      add(
        'error',
        'unknownClone',
        '含未知字段的外部卡牌需要在原 Mod 副本模式中处理',
        c.id,
      );
    for (const g of c.targets) {
      const a = lookupAsset(p.catalog, g);
      if (!a) add('warning', 'targetMissing', `目标 GUID ${g} 未在索引中找到`, c.id);
      else if (a.dlc && !p.dlcs.includes(a.dlc))
        add('warning', 'dlc', `${a.name}需要 ${a.dlc}，请核对游戏环境`, c.id);
    }
  }
  for (const [g, name] of ids) {
    const a = p.catalog?.assets.find((a) => a.guid === g && a.projectId !== p.projectId);
    if (a && !p.cards.some((c) => c.origin && c.guid === g))
      add(
        'error',
        'installedConflict',
        `${name} 的 GUID ${g} 已被索引中的 ${a.name} 使用`,
        p.cards.find((c) => c.guid === g)?.id,
      );
  }
  if (!p.catalog)
    add(
      'info',
      'baseline',
      '当前使用常用 GUID 参考。读取本机资源后可检查配方、原版头像和获取物品池。',
    );
  if (p.cards.some((c) => c.sources.some((s) => s.type === 'gallery')))
    add(
      'info',
      'galleryCheck',
      '艺廊导出使用独立许可／商品条目。请在目标游戏中验证金票购买和帕洛玛交付。',
    );
  return out;
}
