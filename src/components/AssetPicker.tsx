import { useDeferredValue, useMemo, useState } from 'react';
import { Check, Search, Plus } from 'lucide-react';
import type { Asset, Catalog } from '../core/types.ts';
import {
  catalogOf,
  expandTargets,
  worldName,
  normalizeRegions,
} from '../core/catalog.ts';
import { Modal, Portrait } from './common.tsx';
import {
  displayAssetName,
  isInternalPool,
  isScenarioAsset,
} from '../core/assetDisplay.ts';
export function AssetPicker({
  catalog,
  title,
  selected,
  onApply,
  onClose,
  filter = () => true,
  multi = false,
  expand = false,
  onSetup,
  allowPools = false,
}: {
  catalog?: Catalog;
  title: string;
  selected: number[];
  onApply: (ids: number[]) => void;
  onClose: () => void;
  filter?: (a: Asset) => boolean;
  multi?: boolean;
  expand?: boolean;
  onSetup?: () => void;
  allowPools?: boolean;
}) {
  const [query, setQuery] = useState(''),
    [checked, setChecked] = useState(new Set(selected)),
    [region, setRegion] = useState(''),
    [manual, setManual] = useState(''),
    [page, setPage] = useState(0),
    [showPools, setShowPools] = useState(allowPools),
    [showScenarios, setShowScenarios] = useState(false),
    [error, setError] = useState('');
  const q = useDeferredValue(query.toLowerCase()),
    resolvedCatalog = catalogOf(catalog),
    assets = resolvedCatalog.assets;
  const eligible = useMemo(() => assets.filter(filter), [assets, filter]);
  const candidates = useMemo(
    () =>
      eligible.filter(
        (a) =>
          (showPools || !isInternalPool(a)) && (showScenarios || !isScenarioAsset(a)),
      ),
    [eligible, showPools, showScenarios],
  );
  const matches = useMemo(
    () =>
      candidates.filter(
        (a) =>
          (!region ||
            (region === '__unknown'
              ? !normalizeRegions(a.region).length
              : normalizeRegions(a.region).includes(region))) &&
          `${a.name} ${a.english} ${a.internal} ${a.guid} ${a.template} ${a.source ?? ''}`
            .toLowerCase()
            .includes(q),
      ),
    [candidates, q, region],
  );
  const pages = Math.max(1, Math.ceil(matches.length / 60)),
    current = Math.min(page, pages - 1),
    visible = matches.slice(current * 60, (current + 1) * 60);
  const toggle = (id: number) =>
    setChecked((prev) => {
      const n = multi ? new Set(prev) : new Set<number>();
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Modal
      title={title}
      subtitle={
        multi ? '勾选后点击应用；筛选不会清除其他页的选择。' : '选择资源后点击应用。'
      }
      onClose={onClose}
      wide
    >
      {!catalog?.indexVersion && onSetup && (
        <div className="notice resource-hint">
          当前为内置参考。选择游戏根目录可读取全部已安装内容。
          <button
            className="button small"
            onClick={() => {
              onClose();
              onSetup();
            }}
          >
            选择游戏根目录
          </button>
        </div>
      )}
      <div className="picker-tools">
        <label className="search-box">
          <Search size={18} />
          <input
            autoFocus
            placeholder="中文 / English / GUID"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <select
          aria-label="地区"
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
            setPage(0);
          }}
        >
          <option value="">所有世界</option>
          <option value="__unknown">地区未确认</option>
          {[
            ...new Set(
              candidates.flatMap((a) => normalizeRegions(a.region)).filter(Boolean),
            ),
          ].map((r) => (
            <option key={r} value={r}>
              {worldName(r)}
            </option>
          ))}
        </select>
      </div>
      {(expand || eligible.some(isScenarioAsset)) && (
        <details className="advanced-details">
          <summary>更多资源范围</summary>
          {expand && (
            <label className="inline-check">
              <input
                type="checkbox"
                checked={showPools}
                onChange={(event) => {
                  setShowPools(event.target.checked);
                  setPage(0);
                }}
              />
              显示建筑组合（高级）
            </label>
          )}
          {eligible.some(isScenarioAsset) && (
            <label className="inline-check">
              <input
                type="checkbox"
                checked={showScenarios}
                onChange={(event) => {
                  setShowScenarios(event.target.checked);
                  setPage(0);
                }}
              />
              显示场景专用内容
            </label>
          )}
        </details>
      )}
      {allowPools && (
        <p className="notice">
          这是高级资源组合。普通制卡请直接选择商人、任务或远征，无需填写内部物品池。
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {candidates.some((a) => a.kind === 'product') && (
        <p className="picker-help muted">
          商品按生产来源筛选；同一商品可能来自多个世界，也可以跨世界运输。
        </p>
      )}
      <div className="asset-list">
        {visible.map((a) => (
          <button
            className={`asset-row ${checked.has(a.guid) ? 'chosen' : ''}`}
            key={a.guid}
            onClick={() => toggle(a.guid)}
          >
            <span className="check-box">
              {checked.has(a.guid) && <Check size={15} />}
            </span>
            {a.icon && (
              <Portrait
                image={{ mode: 'game', path: a.icon }}
                size="mini"
                refresh={catalog?.fingerprint ?? 0}
              />
            )}
            <span className="asset-copy">
              <strong>{displayAssetName(a, resolvedCatalog)}</strong>
              <small>
                {a.kind === 'product'
                  ? '产地：'
                  : a.kind === 'building' || a.kind === 'residence'
                    ? '建造地区：'
                    : '地区：'}
                {worldName(a.region)}
                {!isInternalPool(a) && a.english && !/[_]/.test(a.english)
                  ? ` · ${a.english}`
                  : ''}
                {isScenarioAsset(a) ? ' · 场景专用' : ''}
                {a.members?.length ? ` · ${a.members.length} 个成员` : ''}
                {a.needFor?.length
                  ? ` · 适用：${a.needFor.map((g) => assets.find((p) => p.guid === g)?.name ?? g).join('、')}`
                  : ''}
              </small>
            </span>
            <span className="asset-meta">
              <code>{a.guid}</code>
              {allowPools && <small>{a.internal ?? a.name}</small>}
            </span>
          </button>
        ))}
        {!visible.length && (
          <div className="empty-state">
            没有匹配资源。请更换筛选或重新读取游戏根目录。
          </div>
        )}
      </div>
      <div className="picker-pagination">
        <span>
          共 {matches.length.toLocaleString()} 条 · 已选 {checked.size}
        </span>
        <button
          className="button small"
          disabled={!current}
          onClick={() => setPage(current - 1)}
        >
          上一页
        </button>
        <span>
          {current + 1} / {pages}
        </span>
        <button
          className="button small"
          disabled={current + 1 >= pages}
          onClick={() => setPage(current + 1)}
        >
          下一页
        </button>
      </div>
      <details className="advanced-details">
        <summary>高级：手动填写 GUID</summary>
        <div className="manual-guid">
          <input
            aria-label="手动输入 GUID"
            placeholder="多个用逗号分隔"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            className="button"
            onClick={() => {
              const ns = manual
                .split(/[,，;\s]+/)
                .map(Number)
                .filter((g) => Number.isInteger(g) && g > 0 && g <= 2147483647);
              if (ns.length) {
                setChecked((prev) => new Set(multi ? [...prev, ...ns] : [ns[0]]));
                setManual('');
              }
            }}
          >
            <Plus size={16} />
            添加 GUID
          </button>
        </div>
      </details>
      <footer className="modal-actions">
        {multi && (
          <>
            <button className="button" onClick={() => setChecked(new Set())}>
              清空选择
            </button>
            <button
              className="button"
              onClick={() =>
                setChecked(new Set([...checked, ...matches.map((a) => a.guid)]))
              }
            >
              全选筛选结果
            </button>
          </>
        )}
        <button
          className="button primary"
          onClick={() => {
            try {
              const ids = [...checked];
              const selected = expand ? expandTargets(resolvedCatalog, ids) : ids;
              if (
                expand &&
                selected.some((g) => {
                  const a = assets.find((a) => a.guid === g);
                  return a && (isInternalPool(a) || !filter(a));
                })
              )
                throw new Error('所选组合包含不适用的资源，请改选具体建筑。');
              onApply(selected);
              onClose();
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          应用选择
        </button>
      </footer>
    </Modal>
  );
}
