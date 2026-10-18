import type { Acquisition, Card, RuleCondition, Source } from './types.ts';
import { element as e, textElement as t } from './xml.ts';
const item = (s: string) => e('Item', s);
const add = (asset: string) => `<ModOp Type="add" Path="/Assets">${asset}</ModOp>`;
const asset = (template: string, guid: number, body: string, base?: number) =>
  e(
    'Asset',
    t('Template', template) +
      (base ? t('BaseAssetGUID', base) : '') +
      e('Values', e('Standard', t('GUID', guid) + t('Name', `CardForge_${guid}`)) + body),
  );
const counter = (type: string, guid: number, amount: number) =>
  e(
    'ConditionPlayerCounter',
    t('PlayerCounter', type) +
      t('Context', guid) +
      t('ComparisonOp', 'AtLeast') +
      t('CounterScope', 'Global') +
      t('CounterAmount', amount),
  );
function rule(r?: RuleCondition) {
  const template = !r
    ? 'ConditionAlwaysTrue'
    : r.type === 'time'
      ? 'ConditionTimer'
      : r.type === 'unlocked'
        ? 'ConditionUnlocked'
        : 'ConditionPlayerCounter';
  const body = !r
    ? e('ConditionAlwaysTrue', '')
    : r.type === 'time'
      ? e('ConditionTimer', t('TimeLimit', r.amount * 60000))
      : r.type === 'unlocked'
        ? e('ConditionUnlocked', t('UnlockNeeded', r.guid))
        : counter(
            r.type === 'population'
              ? 'PopulationByLevel'
              : r.type === 'building'
                ? 'ObjectBuilt'
                : 'GoodsInStock',
            r.guid,
            r.amount,
          );
  return t('Template', template) + e('Values', e('Condition', '') + body);
}
export function preconditions(a: Acquisition) {
  const nested = (i: number): string =>
    e(
      'PreConditionList',
      e('Condition', rule(a.conditions[i])) +
        (i + 1 < a.conditions.length
          ? e(
              'SubConditions',
              item(
                e(
                  'SubCondition',
                  t('Template', 'PreConditionList') + e('Values', nested(i + 1)),
                ),
              ),
            )
          : ''),
    );
  return nested(0);
}
const reward = (card: Card, a: Acquisition) =>
  e(
    'Reward',
    e('RewardAssets', item(t('Reward', card.guid) + t('Amount', a.rewardAmount))) +
      t('GenerateIgnoreUnlocks', 1),
  );
const text = (guid: number) => e('Text', t('LineID', guid));
export function compileAcquisition(card: Card, s: Source): string {
  const a = s.automation;
  if (!a) throw new Error('请补全远征或任务内容');
  const id = a.ids;
  if (s.type === 'quest') {
    const o = a.objective,
      objective = e(
        'Objectives',
        e(
          'WinConditions',
          item(
            e(
              'Objective',
              t('Template', 'SustainObjective') +
                e(
                  'Values',
                  e('ConditionQuestObjective', '') +
                    counter(
                      o.type === 'population'
                        ? 'PopulationByLevel'
                        : o.type === 'building'
                          ? 'ObjectBuilt'
                          : 'GoodsInStock',
                      o.type === 'time' ? 1010017 : o.guid,
                      o.type === 'time' ? 0 : o.amount,
                    ) +
                    e(
                      'ConditionQuestSustain',
                      t('SustainTime', o.seconds * 1000) + t('ResetTimer', 1),
                    ) +
                    e(
                      'ConditionPropsExecutionPlaceSettings',
                      t('ExecutionPlaceConfirmOnReached', 0),
                    ),
                ),
            ),
          ),
        ),
      );
    const quest = asset(
      'A7_QuestSustain',
      id.quest,
      e(
        'Quest',
        t('QuestGiver', a.giverGuid) +
          t('QuestCategory', 'RandomQuest') +
          t('QuestActivation', 'QuestStart') +
          t('StoryText', id.story) +
          t('DescriptionText', id.story) +
          t('IsAbortable', 1) +
          t('MaxSolveCount', a.maxRuns) +
          t('QuestTimeLimit', 0) +
          t('PreActivationTimer', 0) +
          e('QuestSessionDependencies', item(t('SessionOrRegion', a.sessionGuid))),
      ) +
        preconditions(a) +
        objective +
        reward(card, a) +
        text(id.quest),
    );
    const pool = asset(
      'QuestPool',
      id.pool,
      e(
        'QuestPool',
        e('Quests', item(t('Quest', id.quest) + t('Weight', s.weight))) +
          t('PoolCooldown', a.cooldownMinutes * 60000) +
          t('QuestCooldown', 0) +
          t('CooldownOnQuestStart', 1) +
          t('CooldownOnQuestEnd', 0) +
          t('IsMainStoryPool', 0) +
          t('IsTopLevel', 1) +
          t('QuestLimit', 1),
      ) + e('Locked', t('DefaultLockedState', 0)),
    );
    return add(quest) + add(pool);
  }
  const x = a.expedition;
  const mission = asset(
    'Expedition',
    id.mission,
    e(
      'Expedition',
      t('ExpeditionName', id.mission) +
        t('ExpeditionDescription', id.story) +
        t('ExpeditionRegion', x.region) +
        t('ExpeditionDifficulty', x.difficulty) +
        t('ExpeditionCategory', x.category) +
        e('EventList', item(t('EventOrEventPool', id.event))) +
        t('FillEventPool', 0) +
        t('FillThreats', 0) +
        t('IsMandatory', 1) +
        t('Reward', id.reward),
    ) + e('Locked', t('DefaultLockedState', 1)),
    x.baseGuid,
  );
  const event = asset(
    'ExpeditionEvent',
    id.event,
    e(
      'ExpeditionEvent',
      t(
        'EventRegion',
        'Arctic;NorthernEurope;NorthAmerica;SouthAmerica;NorthAfrica;Africa;SouthernEurope;SouthernSouthAmerica;NorthernNorthAmerica;CentralEurope',
      ) + t('StartDecision', id.decision),
    ) + text(id.event),
  );
  const decision = asset(
    'ExpeditionDecision',
    id.decision,
    e(
      'ExpeditionDecision',
      e(
        'Options',
        item(t('Option', id.option)) +
          (x.requiredProduct ? item(t('Option', id.skipOption)) : ''),
      ),
    ) + text(id.decision),
  );
  const follow = (guid: number) =>
    e(
      'FollowupDecisions',
      item(
        t('Decision', guid) + t('Threshold', 'NeutralThreshold') + t('ThresholdValue', 0),
      ),
    );
  const option = asset(
    'ExpeditionOption',
    id.option,
    e(
      'ExpeditionOption',
      follow(id.success) +
        (x.requiredProduct
          ? e(
              'Requirements',
              item(t('ItemOrProduct', x.requiredProduct) + t('Amount', x.requiredAmount)),
            ) + t('ConsumeRequirement', 1)
          : ''),
    ) + text(id.option),
  );
  const success = asset(
    'ExpeditionDecision',
    id.success,
    e('ExpeditionDecision', '') + reward(card, a) + text(id.success),
  );
  const finalReward = asset(
    'ExpeditionDecision',
    id.reward,
    e('ExpeditionDecision', '') + e('Reward', '') + text(id.reward),
  );
  const skip = x.requiredProduct
    ? add(
        asset(
          'ExpeditionOption',
          id.skipOption,
          e('ExpeditionOption', follow(id.skipDecision)) + text(id.skipOption),
        ),
      ) +
      add(
        asset(
          'ExpeditionDecision',
          id.skipDecision,
          e('ExpeditionDecision', '') + e('Reward', '') + text(id.skipDecision),
        ),
      )
    : '';
  const actions = e(
    'TriggerActions',
    item(
      e(
        'TriggerAction',
        t('Template', 'ActionUnlockAsset') +
          e(
            'Values',
            e('Action', '') +
              e('ActionUnlockAsset', e('UnlockAssets', item(t('Asset', id.mission)))),
          ),
      ),
    ),
  );
  const nestedTrigger = (i: number): string =>
    e(
      'Trigger',
      e('TriggerCondition', rule(a.conditions[i])) +
        (i + 1 < a.conditions.length
          ? e(
              'SubTriggers',
              item(
                e(
                  'SubTrigger',
                  t('Template', 'AutoCreateTrigger') + e('Values', nestedTrigger(i + 1)),
                ),
              ),
            )
          : actions) +
        e(
          'ResetTrigger',
          t('Template', 'EmptyAutoCreateValue') +
            e('Values', e('EmptyAutoCreateValue', '')),
        ),
    );
  const trigger = asset(
    'Trigger',
    id.trigger,
    e(
      'TriggerSetup',
      t('AutoRegisterTrigger', 1) + t('AutoSelfUnlock', 1) + t('UsedBySecondParties', 0),
    ) + nestedTrigger(0),
  );
  const slot = `<ModOp Type="add" GUID="${x.slotGuid}" Path="/Values/ExpeditionSlot[not(SpecialExpeditionsSlot)]"><SpecialExpeditionsSlot/></ModOp><ModOp Type="add" GUID="${x.slotGuid}" Path="/Values/ExpeditionSlot/SpecialExpeditionsSlot">${item(t('ExpeditionGUID', id.mission))}</ModOp>`;
  return (
    [mission, event, decision, option, success, finalReward, trigger].map(add).join('') +
    skip +
    slot
  );
}
export function acquisitionTexts(card: Card): [number, string][] {
  return card.status !== 'active'
    ? []
    : card.sources.flatMap((s) => {
        const a = s.automation;
        if (!a) return [];
        const id = a.ids;
        if (s.type === 'quest')
          return [
            [id.quest, a.title],
            [id.story, a.story],
          ] as [number, string][];
        const x = a.expedition;
        return [
          [id.mission, a.title],
          [id.story, a.story],
          [id.event, x.eventTitle],
          [id.decision, x.eventText],
          [id.option, x.optionText],
          [id.success, `获得 ${a.rewardAmount} 张${card.name}。`],
          [id.reward, '远征结束，欢迎归来。'],
          ...(x.requiredProduct
            ? [
                [id.skipOption, '绕行，继续旅程'],
                [id.skipDecision, '这次没有取得奖励。'],
              ]
            : []),
        ] as [number, string][];
      });
}
