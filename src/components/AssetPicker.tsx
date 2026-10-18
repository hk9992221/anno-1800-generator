import { useDeferredValue, useMemo, useState } from 'react';
import { Check, Search, Plus } from 'lucide-react';
import type { Asset, Catalog } from '../core/types.ts';
import { catalogOf, expandTargets, worldName } from '../core/catalog.ts';
import { Modal, Portrait } from './common.tsx';
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
}) {
  const [query, setQuery] = useState(''),
    [checked, setChecked] = useState(new Set(selected)),
    [region, setRegion] = useState(''),
    [manual, setManual] = useState(''),
    [page, setPage] = useState(0);
  const q = useDeferredValue(query.toLowerCase()),
    assets = catalogOf(catalog).assets;
  const candidates = useMemo(() => assets.filter(filter), [assets, filter]);
  const matches = useMemo(
    () =>
      candidates.filter(
        (a) =>
          (!region || (a.region ?? '').split(/[,;\s]+/).includes(region)) &&
          `${a.name} ${a.english} ${a.guid} ${a.template} ${a.source ?? ''}`
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
          {[
            ...new Set(
              candidates
                .flatMap((a) => (a.region ?? '').split(/[,;\s]+/))
                .filter(Boolean),
            ),
          ].map((r) => (
            <option key={r} value={r}>
              {worldName(r)}
            </option>
          ))}
        </select>
      </div>
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
              <strong>{a.name}</strong>
              <small>
                {worldName(a.region)} · {a.english}
                {a.members?.length ? ` · ${a.members.length} 个成员` : ''}
                {a.needFor?.length
                  ? ` · 适用：${a.needFor.map((g) => assets.find((p) => p.guid === g)?.name ?? g).join('、')}`
                  : ''}
              </small>
            </span>
            <span className="asset-meta">
              <code>{a.guid}</code>
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
            const ids = [...checked];
            onApply(expand ? expandTargets(catalogOf(catalog), ids) : ids);
            onClose();
          }}
        >
          应用选择
        </button>
      </footer>
    </Modal>
  );
}
