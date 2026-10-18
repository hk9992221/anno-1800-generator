import { useDeferredValue, useMemo, useState } from 'react';
import { Check, Search, Plus } from 'lucide-react';
import type { Asset, Catalog } from '../core/types.ts';
import { catalogOf, expandTargets } from '../core/catalog.ts';
import { Modal } from './common.tsx';
export function AssetPicker({
  catalog,
  title,
  selected,
  onApply,
  onClose,
  filter = () => true,
  multi = false,
  expand = false,
}: {
  catalog?: Catalog;
  title: string;
  selected: number[];
  onApply: (ids: number[]) => void;
  onClose: () => void;
  filter?: (a: Asset) => boolean;
  multi?: boolean;
  expand?: boolean;
}) {
  const [query, setQuery] = useState(''),
    [checked, setChecked] = useState(new Set(selected)),
    [region, setRegion] = useState(''),
    [manual, setManual] = useState('');
  const q = useDeferredValue(query.toLowerCase());
  const assets = catalogOf(catalog).assets;
  const candidates = useMemo(() => assets.filter(filter), [assets, filter]);
  const matches = useMemo(
    () =>
      candidates.filter(
        (a) =>
          (!region || a.region === region) &&
          `${a.name} ${a.english} ${a.guid} ${a.template}`.toLowerCase().includes(q),
      ),
    [candidates, q, region],
  );
  const visible = matches.slice(0, 150);
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
        multi ? '可多选，目标池默认展开并固定为具体建筑。' : '选择资源，或输入已知的游戏 GUID。'
      }
      onClose={onClose}
      wide
    >
      <div className="picker-tools">
        <label className="search-box">
          <Search size={18} />
          <input
            autoFocus
            placeholder="中文 / English / GUID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">所有地区</option>
          {[...new Set(candidates.map((a) => a.region).filter(Boolean))].map((r) => (
            <option key={r}>{r}</option>
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
            <span className="check-box">{checked.has(a.guid) && <Check size={15} />}</span>
            <span className="asset-copy">
              <strong>{a.name}</strong>
              <small>
                {a.english} {a.members?.length ? `· ${a.members.length} 个成员` : ''}
              </small>
            </span>
            <span className="asset-meta">
              {a.dlc && <span>{a.dlc}</span>}
              <code>{a.guid}</code>
            </span>
          </button>
        ))}
        {!visible.length && (
          <div className="empty-state">没有匹配资源。可读取本机游戏数据，或输入已知 GUID。</div>
        )}
      </div>
      <div className="manual-guid">
        <input
          aria-label="手动输入 GUID"
          placeholder="手动输入 GUID，多个用逗号分隔"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button
          className="button"
          onClick={() => {
            const numbers = manual
              .split(/[,，;\s]+/)
              .map(Number)
              .filter((g) => Number.isInteger(g) && g > 0 && g <= 2147483647);
            if (numbers.length) {
              setChecked((prev) => new Set(multi ? [...prev, ...numbers] : [numbers[0]]));
              setManual('');
            }
          }}
        >
          <Plus size={16} />
          添加 GUID
        </button>
      </div>
      <footer className="modal-actions">
        <span className="muted">
          显示 {visible.length}/{matches.length} 条 · 已选 {checked.size}
        </span>
        {multi && (
          <button
            className="button"
            onClick={() => setChecked(new Set([...checked, ...visible.map((a) => a.guid)]))}
          >
            全选当前结果
          </button>
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
