import { NumberInput } from './NumberInput.tsx';
import { useState } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import type {
  Acquisition,
  Asset,
  Card,
  Catalog,
  RuleCondition,
  Source,
} from '../core/types.ts';
import { uid } from '../core/types.ts';
import { assetName, catalogOf, worldName } from '../core/catalog.ts';
import { AssetPicker } from './AssetPicker.tsx';
import { Field, Empty } from './common.tsx';
const STAGES: Record<string, string> = {
  EarlyGame: '早期',
  EarlyMidGame: '前中期',
  MidGame: '中期',
  LateMidGame: '中后期',
  LateGame: '后期',
  EndGame: '终局',
};
const RULES: Record<RuleCondition['type'], string> = {
  population: '指定阶级人口达到',
  building: '拥有指定建筑',
  stock: '全局库存达到',
  time: '等待分钟数',
  unlocked: '已解锁指定资产',
};
export function SourcesEditor({
  card,
  catalog,
  onChange,
  onAdd,
  onSetup,
}: {
  card: Card;
  catalog?: Catalog;
  onChange: (p: Partial<Card>) => void;
  onAdd: (type: Source['type']) => void;
  onSetup: () => void;
}) {
  const [picker, setPicker] = useState<{
    title: string;
    selected: number[];
    filter: (a: Asset) => boolean;
    allowPools?: boolean;
    apply: (ids: number[]) => void;
  } | null>(null);
  const traders = catalogOf(catalog).traders ?? [];
  const update = (s: Source, p: Partial<Source>) =>
    onChange({
      sources: card.sources.map((x) => (x.id === s.id ? { ...s, ...p } : x)),
    });
  const auto = (s: Source, p: Partial<Acquisition>) => {
    if (s.automation) update(s, { automation: { ...s.automation, ...p } });
  };
  const resource = (
    label: string,
    guid: number,
    filter: (a: Asset) => boolean,
    apply: (id: number) => void,
    allowPools = false,
  ) => (
    <button
      className="resource-button"
      onClick={() =>
        setPicker({
          title: label,
          selected: guid ? [guid] : [],
          filter,
          allowPools,
          apply: (ids) => apply(ids[0] ?? 0),
        })
      }
    >
      {guid ? assetName(catalog, guid) : label}
      <Search size={15} />
    </button>
  );
  const conditions = (s: Source, a: Acquisition) => (
    <div className="trigger-editor">
      <h4>出现条件（全部满足后开放）</h4>
      <p className="muted compact">
        没有条件表示进入游戏后即可出现；等待从游戏启用该条件起计时。远征还需游戏已开放远征功能。
      </p>
      {a.conditions.map((r) => (
        <div className="condition-row" key={r.id}>
          <select
            aria-label="触发条件类型"
            value={r.type}
            onChange={(ev) =>
              auto(s, {
                conditions: a.conditions.map((x) =>
                  x.id === r.id
                    ? {
                        ...r,
                        type: ev.target.value as RuleCondition['type'],
                        guid: 0,
                      }
                    : x,
                ),
              })
            }
          >
            {Object.entries(RULES).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          {r.type !== 'time' &&
            resource(
              '选择条件资源',
              r.guid,
              (x) =>
                r.type === 'population'
                  ? x.kind === 'population'
                  : r.type === 'building'
                    ? x.kind === 'building' || x.kind === 'residence'
                    : r.type === 'stock'
                      ? x.kind === 'product'
                      : true,
              (guid) =>
                auto(s, {
                  conditions: a.conditions.map((x) =>
                    x.id === r.id ? { ...r, guid } : x,
                  ),
                }),
            )}
          {r.type !== 'unlocked' && (
            <NumberInput
              min={0}
              aria-label="条件数量"
              value={r.amount}
              onValueChange={(value) =>
                auto(s, {
                  conditions: a.conditions.map((x) =>
                    x.id === r.id ? { ...r, amount: value } : x,
                  ),
                })
              }
            />
          )}
          <button
            className="icon-button"
            aria-label="删除触发条件"
            onClick={() =>
              auto(s, { conditions: a.conditions.filter((x) => x.id !== r.id) })
            }
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        className="button small"
        onClick={() =>
          auto(s, {
            conditions: [
              ...a.conditions,
              { id: uid(), type: 'population', guid: 0, amount: 100 },
            ],
          })
        }
      >
        <Plus size={15} />
        添加出现条件
      </button>
    </div>
  );
  return (
    <div className="editor-section">
      <div className="section-heading">
        <div>
          <h2>怎样获得这张卡牌</h2>
          <p>同一卡牌可以同时设置多个获取途径。</p>
        </div>
      </div>
      <div className="source-buttons">
        {(['gallery', 'trader', 'expedition', 'quest'] as const).map((type) => (
          <button
            className="button"
            key={type}
            disabled={
              type === 'gallery' && card.sources.some((s) => s.type === 'gallery')
            }
            onClick={() => onAdd(type)}
          >
            <Plus size={16} />
            {
              {
                gallery: '壮丽艺廊',
                trader: '商人购买',
                expedition: '远征事件',
                quest: '任务奖励',
              }[type]
            }
          </button>
        ))}
      </div>
      {card.sources.map((s) => (
        <article className="source-card" key={s.id}>
          <header>
            <strong>
              {
                {
                  gallery: '壮丽艺廊',
                  trader: '商人购买',
                  expedition: '远征事件',
                  quest: '任务奖励',
                  research: '研究所（高级）',
                  visitor: '访客（高级）',
                  craft: '制作',
                }[s.type]
              }
            </strong>
            <button
              className="icon-button"
              aria-label="删除获取途径"
              onClick={() =>
                onChange({ sources: card.sources.filter((x) => x.id !== s.id) })
              }
            >
              <Trash2 size={17} />
            </button>
          </header>
          {s.type === 'gallery' ? (
            <>
              <p className="muted compact">金票购买后通过单人游戏的帕洛玛领取。</p>
              <div className="form-grid">
                <Field label="金票价格">
                  <NumberInput
                    min={1}
                    value={s.tickets}
                    onValueChange={(value) => update(s, { tickets: value })}
                  />
                </Field>
                <Field label="购买次数上限">
                  <NumberInput
                    min={1}
                    max={99}
                    value={s.maxCount}
                    onValueChange={(value) => update(s, { maxCount: value })}
                  />
                </Field>
                <Field label="后续价格倍率">
                  <NumberInput
                    min={1}
                    step={0.1}
                    value={s.scale}
                    onValueChange={(value) => update(s, { scale: value })}
                  />
                </Field>
              </div>
            </>
          ) : s.type === 'trader' ? (
            <>
              <div className="form-grid">
                <Field label="选择商人">
                  <select
                    aria-label="选择商人"
                    disabled={!traders.length}
                    value={s.traderGuid ?? ''}
                    onChange={(e) => {
                      const t = traders.find((t) => t.guid === Number(e.target.value));
                      const stage =
                        t?.stages.find((st) => st.stage === s.stage) ?? t?.stages[0];
                      update(s, {
                        traderGuid: t?.guid,
                        label: t?.name ?? '商人购买',
                        stage: stage?.stage,
                        poolGuid: stage?.poolGuid ?? 0,
                      });
                    }}
                  >
                    <option value="">
                      {traders.length ? '请选择商人' : '先读取游戏资源以识别商人'}
                    </option>
                    {traders.map((t) => (
                      <option key={t.guid} value={t.guid} disabled={!t.stages.length}>
                        {t.name}
                        {t.regions?.length ? ` · ${worldName(t.regions)}` : ''}
                        {!t.stages.length ? '（未识别卡牌池）' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="解锁阶段">
                  <select
                    aria-label="解锁阶段"
                    value={s.stage ?? ''}
                    disabled={!s.traderGuid}
                    onChange={(e) => {
                      const stage = traders
                        .find((t) => t.guid === s.traderGuid)
                        ?.stages.find((st) => st.stage === e.target.value);
                      update(s, {
                        stage: e.target.value,
                        poolGuid: stage?.poolGuid ?? 0,
                      });
                    }}
                  >
                    <option value="">请选择阶段</option>
                    {(traders.find((t) => t.guid === s.traderGuid)?.stages ?? []).map(
                      (st) => (
                        <option key={st.stage} value={st.stage}>
                          {STAGES[st.stage] ?? st.stage}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
              </div>
              {!traders.length && (
                <div className="notice">
                  尚未读取到商人交易配置。选择游戏根目录后自动识别，商人和物品池会一起切换。
                  <button className="button small" onClick={onSetup}>
                    选择游戏根目录
                  </button>
                </div>
              )}
              {!catalog?.indexedAt && (
                <p className="muted compact">
                  当前为内置商人参考，包含老奈特和其他已知商人。读取游戏后以本机交易配置为准；DLC、交易权及存档解锁条件由游戏决定。
                </p>
              )}
              <div className="resolved-pool">
                <strong>卡牌出售配置</strong>
                <p>
                  {s.poolGuid
                    ? `${s.label} · ${STAGES[s.stage ?? ''] ?? '已设置'}上架`
                    : '选择商人和阶段后自动填写'}
                </p>
                <small>出售列表由游戏配置自动匹配，无需手动选择内部物品池。</small>
              </div>
              <Weight source={s} update={(p) => update(s, p)} />
              <details className="advanced-details">
                <summary>高级：覆盖自动物品池</summary>
                {resource(
                  '选择物品池',
                  s.poolGuid,
                  (a) => !!a.poolPath,
                  (poolGuid) =>
                    update(s, {
                      poolGuid,
                      traderGuid: undefined,
                      stage: undefined,
                    }),
                  true,
                )}
              </details>
            </>
          ) : s.type === 'quest' || s.type === 'expedition' ? (
            (() => {
              const a = s.automation;
              if (!a)
                return (
                  <div className="notice">
                    旧渠道只有物品池，没有完整事件配置。请删除此途径后重新添加。
                  </div>
                );
              const x = a.expedition,
                o = a.objective;
              const exp = (p: Partial<typeof x>) =>
                auto(s, { expedition: { ...x, ...p } });
              const obj = (p: Partial<typeof o>) =>
                auto(s, { objective: { ...o, ...p } });
              return (
                <>
                  <div className="form-grid">
                    <Field label={s.type === 'quest' ? '任务名称' : '远征名称'} wide>
                      <input
                        value={a.title}
                        onChange={(e) => auto(s, { title: e.target.value })}
                      />
                    </Field>
                    <Field label="任务说明" wide>
                      <textarea
                        rows={2}
                        value={a.story}
                        onChange={(e) => auto(s, { story: e.target.value })}
                      />
                    </Field>
                    <Field label="奖励本卡数量">
                      <NumberInput
                        min={1}
                        max={99}
                        value={a.rewardAmount}
                        onValueChange={(value) => auto(s, { rewardAmount: value })}
                      />
                    </Field>
                  </div>
                  {s.type === 'quest' ? (
                    <>
                      <div className="form-grid">
                        <Field label="任务发生地区">
                          {resource(
                            '选择地区',
                            a.sessionGuid,
                            (b) => /Session/.test(b.template),
                            (sessionGuid) => auto(s, { sessionGuid }),
                          )}
                        </Field>
                        <Field label="发布人">
                          {resource(
                            '选择发布人',
                            a.giverGuid,
                            (b) => b.kind === 'profile',
                            (giverGuid) => auto(s, { giverGuid }),
                          )}
                        </Field>
                        <Field label="完成次数上限">
                          <NumberInput
                            min={1}
                            value={a.maxRuns}
                            onValueChange={(value) => auto(s, { maxRuns: value })}
                          />
                        </Field>
                        <Field label="再次发布间隔（分钟）">
                          <NumberInput
                            min={0}
                            max={1440}
                            value={a.cooldownMinutes}
                            onValueChange={(value) =>
                              auto(s, {
                                cooldownMinutes: value,
                              })
                            }
                          />
                        </Field>
                      </div>
                      <h4>玩家需要完成什么</h4>
                      <div className="form-grid">
                        <Field label="任务目标">
                          <select
                            value={o.type}
                            onChange={(e) =>
                              obj({
                                type: e.target.value as typeof o.type,
                                guid: 0,
                                amount: 1,
                              })
                            }
                          >
                            <option value="stock">保持全局商品库存</option>
                            <option value="building">保持指定建筑数量</option>
                            <option value="population">保持指定阶级人口</option>
                            <option value="time">保持资金非负</option>
                          </select>
                        </Field>
                        {o.type !== 'time' && (
                          <>
                            <Field label="目标资源">
                              {resource(
                                '选择任务目标',
                                o.guid,
                                (b) =>
                                  o.type === 'stock'
                                    ? b.kind === 'product'
                                    : o.type === 'population'
                                      ? b.kind === 'population'
                                      : b.kind === 'building' || b.kind === 'residence',
                                (guid) => obj({ guid }),
                              )}
                            </Field>
                            <Field label="达到数量">
                              <NumberInput
                                min={1}
                                value={o.amount}
                                onValueChange={(value) => obj({ amount: value })}
                              />
                            </Field>
                          </>
                        )}
                        <Field label="连续保持秒数">
                          <NumberInput
                            min={1}
                            max={86400}
                            value={o.seconds}
                            onValueChange={(value) => obj({ seconds: value })}
                          />
                        </Field>
                      </div>
                      <p className="muted compact">
                        任务没有完成倒计时。发布后开始检查目标；低于目标数量会重新计时，达到保持时间后奖励卡牌。
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="form-grid">
                        <Field label="远征外观模板" hint="复用游戏的地图、航线与视频。">
                          {resource(
                            '选择远征模板',
                            x.baseGuid,
                            (b) => b.kind === 'expedition',
                            (baseGuid) => {
                              const base = catalogOf(catalog).assets.find(
                                (b) => b.guid === baseGuid,
                              );
                              const region = base?.expeditionRegion || x.region;
                              exp({
                                baseGuid,
                                region,
                                slotGuid:
                                  catalogOf(catalog).assets.find(
                                    (b) =>
                                      b.template === 'ExpeditionSlot' &&
                                      b.slotRegion === region,
                                  )?.guid ?? 0,
                              });
                            },
                          )}
                        </Field>
                        <Field label="远征海域">
                          <select
                            value={x.region}
                            onChange={(e) => {
                              const region = e.target.value;
                              exp({
                                region,
                                slotGuid:
                                  catalogOf(catalog).assets.find(
                                    (b) =>
                                      b.template === 'ExpeditionSlot' &&
                                      b.slotRegion === region,
                                  )?.guid ?? 0,
                              });
                            }}
                          >
                            {[
                              'NorthernEurope',
                              'SouthernEurope',
                              'CentralEurope',
                              'SouthAmerica',
                              'Arctic',
                              'Africa',
                            ].map((r) => (
                              <option key={r} value={r}>
                                {
                                  {
                                    NorthernEurope: '北欧',
                                    SouthernEurope: '南欧',
                                    CentralEurope: '中欧',
                                    SouthAmerica: '南美洲',
                                    Arctic: '北极',
                                    Africa: '非洲',
                                  }[r]
                                }
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="远征难度">
                          <select
                            value={x.difficulty}
                            onChange={(e) => exp({ difficulty: e.target.value })}
                          >
                            <option value="Easy">简单</option>
                            <option value="Average">普通</option>
                            <option value="Hard">困难</option>
                          </select>
                        </Field>
                        <Field label="远征类型">
                          <select
                            value={x.category}
                            onChange={(e) => exp({ category: e.target.value })}
                          >
                            {Object.entries({
                              RescueMission: '营救',
                              Zoological: '动物',
                              Archeological: '考古',
                              Botanical: '植物',
                              PirateHunt: '海盗',
                              Discovery: '探索',
                            }).map(([v, n]) => (
                              <option key={v} value={v}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="出现位置">
                          {resource(
                            '选择远征槽',
                            x.slotGuid,
                            (b) => b.template === 'ExpeditionSlot',
                            (slotGuid) => exp({ slotGuid }),
                          )}
                        </Field>
                        <Field label="事件标题">
                          <input
                            value={x.eventTitle}
                            onChange={(e) => exp({ eventTitle: e.target.value })}
                          />
                        </Field>
                        <Field label="事件内容" wide>
                          <textarea
                            rows={3}
                            value={x.eventText}
                            onChange={(e) => exp({ eventText: e.target.value })}
                          />
                        </Field>
                        <Field label="取得奖励的选项" wide>
                          <input
                            value={x.optionText}
                            onChange={(e) => exp({ optionText: e.target.value })}
                          />
                        </Field>
                      </div>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={!!x.requiredProduct}
                          onChange={(e) =>
                            exp({
                              requiredProduct: e.target.checked ? 120008 : 0,
                            })
                          }
                        />
                        选项需要携带并消耗物资
                      </label>
                      {!!x.requiredProduct && (
                        <div className="form-grid">
                          <Field label="需要物资">
                            {resource(
                              '选择物资',
                              x.requiredProduct,
                              (b) => b.kind === 'product',
                              (requiredProduct) => exp({ requiredProduct }),
                            )}
                          </Field>
                          <Field label="消耗数量">
                            <NumberInput
                              min={1}
                              value={x.requiredAmount}
                              onValueChange={(value) => exp({ requiredAmount: value })}
                            />
                          </Field>
                        </div>
                      )}
                      <p className="muted compact">
                        此途径生成一次性特殊远征。满足出现条件后开放，事件选项成功后取得卡牌；需要物资时同时提供无奖励的绕行选项。
                      </p>
                    </>
                  )}
                  {conditions(s, a)}
                </>
              );
            })()
          ) : (
            <>
              <Field label="渠道备注">
                <input
                  value={s.label}
                  onChange={(e) => update(s, { label: e.target.value })}
                />
              </Field>
              {resource(
                '选择已确认的物品池',
                s.poolGuid,
                (a) => !!a.poolPath,
                (poolGuid) => update(s, { poolGuid }),
                true,
              )}
              <Weight source={s} update={(p) => update(s, p)} />
              <p className="muted compact">
                高级入口只修改已知池，不会自动建立该系统的解锁或任务逻辑。
              </p>
            </>
          )}
        </article>
      ))}
      {!card.sources.length && <Empty>选择获取途径，让卡牌出现在游戏中。</Empty>}
      <details className="advanced-details">
        <summary>高级获取途径</summary>
        <div className="source-buttons">
          <button className="button small" onClick={() => onAdd('research')}>
            研究所已知池
          </button>
          <button className="button small" onClick={() => onAdd('visitor')}>
            访客已知池
          </button>
        </div>
      </details>
      {picker && (
        <AssetPicker
          {...picker}
          catalog={catalog}
          onApply={picker.apply}
          onClose={() => setPicker(null)}
          onSetup={onSetup}
        />
      )}
    </div>
  );
}
function Weight({
  source: s,
  update,
}: {
  source: Source;
  update: (p: Partial<Source>) => void;
}) {
  return (
    <Field
      label="池内相对权重"
      hint="本编辑器范围：1–1,000,000 的整数。权重越高，同一池内越容易被抽中。例如只有权重 100 和 200 两项时，单次抽取约为 1/3 和 2/3；多层池、解锁条件和多次抽取会影响最终概率。"
    >
      <NumberInput
        min={1}
        max={1000000}
        value={s.weight}
        onValueChange={(value) => update({ weight: value })}
      />
    </Field>
  );
}
