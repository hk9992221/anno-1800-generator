import { useMemo, useState, useDeferredValue } from 'react';
import type { Catalog } from '../core/types.ts';
import { catalogOf } from '../core/catalog.ts';
import { Modal, Portrait } from './common.tsx';
export function PortraitPicker({
  catalog,
  selected,
  onApply,
  onClose,
}: {
  catalog?: Catalog;
  selected: string;
  onApply: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [all, setAll] = useState(false),
    [chosen, setChosen] = useState(selected),
    [page, setPage] = useState(0);
  const q = useDeferredValue(query.toLowerCase());
  const items = useMemo(() => {
    const map = new Map<string, { path: string; name: string; person: boolean }>();
    for (const a of catalogOf(catalog).assets) {
      if (a.icon)
        map.set(a.icon.toLowerCase(), {
          path: a.icon,
          name: `${a.name} ${a.english}`,
          person: a.kind === 'portrait',
        });
    }
    for (const path of catalog?.portraits ?? []) {
      if (!map.has(path.toLowerCase()))
        map.set(path.toLowerCase(), {
          path,
          name: path.split('/').pop() ?? path,
          person: /specialist|portrait|characters/i.test(path),
        });
    }
    return [...map.values()];
  }, [catalog]);
  const matches = items.filter(
      (a) => (all || a.person) && `${a.name} ${a.path}`.toLowerCase().includes(q),
    ),
    pages = Math.max(1, Math.ceil(matches.length / 48)),
    current = Math.min(page, pages - 1);
  return (
    <Modal
      title="选择游戏头像"
      subtitle="点击缩略图预览，再点击使用此头像。图片由本机游戏与已安装 Mod 读取。"
      onClose={onClose}
      wide
    >
      <div className="picker-tools">
        <input
          autoFocus
          aria-label="搜索头像"
          placeholder="搜索头像名称"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <label className="check-label">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => {
              setAll(e.target.checked);
              setPage(0);
            }}
          />
          显示所有游戏图标
        </label>
      </div>
      <div className="portrait-browser">
        <div className="portrait-grid">
          {matches.slice(current * 48, (current + 1) * 48).map((a) => (
            <button
              key={a.path}
              className={`portrait-choice ${chosen === a.path ? 'chosen' : ''}`}
              title={a.name}
              aria-label={a.name}
              onClick={() => setChosen(a.path)}
            >
              <Portrait
                image={{ mode: 'game', path: a.path }}
                refresh={catalog?.fingerprint ?? 0}
              />
              <small>{a.name}</small>
            </button>
          ))}
          {!matches.length && (
            <p className="muted">没有匹配头像，试试显示所有游戏图标。</p>
          )}
        </div>
        <div className="portrait-selection">
          <Portrait
            image={{ mode: 'game', path: chosen }}
            size="large"
            refresh={catalog?.fingerprint ?? 0}
          />
          <p>{items.find((a) => a.path === chosen)?.name ?? '选择一个头像'}</p>
        </div>
      </div>
      <div className="picker-pagination">
        <span>{matches.length.toLocaleString()} 张</span>
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
      <footer className="modal-actions">
        <button
          className="button primary"
          disabled={!chosen}
          onClick={() => {
            onApply(chosen);
            onClose();
          }}
        >
          使用此头像
        </button>
      </footer>
    </Modal>
  );
}
