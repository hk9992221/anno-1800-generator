import { useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import type { Project } from '../core/types.ts';
import { catalogOf } from '../core/catalog.ts';
import { Field, Modal } from './common.tsx';
export function ProjectSettings({
  project,
  onApply,
  onClose,
  onIndex,
  onScan,
  busy,
  progress,
  onCancel,
}: {
  project: Project;
  onApply: (p: Project) => void;
  onClose: () => void;
  onIndex: (changeRoot?: boolean) => void;
  onScan: () => void;
  busy: boolean;
  progress: string;
  onCancel: () => void;
}) {
  const [name, setName] = useState(project.name),
    [deps, setDeps] = useState(project.dependencies.join('\n')),
    [dlcs, setDlcs] = useState(project.dlcs.join('\n')),
    [start, setStart] = useState(project.guidRange.start),
    [end, setEnd] = useState(project.guidRange.end);
  const cat = catalogOf(project.catalog);
  return (
    <Modal title="工程与游戏资源" onClose={onClose} wide>
      <div className="dialog-body">
        <div className="resource-banner">
          <FolderOpen size={26} />
          <div>
            <strong>
              {cat.gameRoot ? '已连接游戏目录' : '先选择 Anno 1800 游戏根目录'}
            </strong>
            <p className="break-path">
              {cat.gameRoot ??
                '选择包含 maindata 和 Bin 的文件夹，不需要自己找 XML、头像或 mods。'}
            </p>
            <small>
              {cat.assets.length.toLocaleString()} 条资源 · {cat.modCount ?? 0} 个已扫描
              Mod
            </small>
          </div>
        </div>
        <div className="source-buttons">
          <button
            className="button primary"
            disabled={busy}
            onClick={() => onIndex(!cat.gameRoot)}
          >
            <RefreshCw size={17} className={busy ? 'spinning' : ''} />
            {cat.gameRoot ? '重新读取游戏资源' : '选择游戏根目录'}
          </button>
          {cat.gameRoot && (
            <button className="button" disabled={busy} onClick={() => onIndex(true)}>
              更换游戏目录
            </button>
          )}
          <button className="button" disabled={busy} onClick={onScan}>
            扫描已安装 Mod
          </button>
        </div>
        <p className="muted compact">
          自动检查游戏目录和 Windows 文档中的 Anno
          1800/mods；下次使用会记住游戏位置。读取成功后可直接预览头像。未安装的 DLC
          或未扫描的第三方资源不会被当成已确认数据。
        </p>
        {cat.modRoots?.length ? (
          <details className="advanced-details">
            <summary>已识别的 Mod 目录</summary>
            {cat.modRoots.map((p) => (
              <p className="break-path" key={p}>
                {p}
              </p>
            ))}
          </details>
        ) : null}
        {cat.warnings?.length ? (
          <details className="advanced-details">
            <summary>有 {cat.warnings.length} 条资源读取提示</summary>
            {cat.warnings.map((s, i) => (
              <p className="break-path" key={i}>
                {s}
              </p>
            ))}
          </details>
        ) : null}
        {busy && (
          <div className="progress-notice">
            <span>{progress || '正在识别游戏资源…'}</span>
            <button className="button small" onClick={onCancel}>
              取消
            </button>
          </div>
        )}
        <Field label="工程显示名称">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <details className="advanced-details">
          <summary>高级：导出身份、GUID 与依赖</summary>
          <div className="form-grid">
            <Field label="固定 ModID">
              <input readOnly value={project.modId} />
            </Field>
            <Field label="固定导出目录">
              <input readOnly value={project.folderName} />
            </Field>
            <Field label="固定 ZIP 名称">
              <input readOnly value={project.zipName} />
            </Field>
            <Field label="GUID 范围起点">
              <input
                type="number"
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
              />
            </Field>
            <Field label="GUID 范围终点">
              <input
                type="number"
                value={end}
                onChange={(e) => setEnd(Number(e.target.value))}
              />
            </Field>
            <Field label="来源 Mod 依赖" hint="每行一个准确的 ModID。">
              <textarea rows={3} value={deps} onChange={(e) => setDeps(e.target.value)} />
            </Field>
            <Field label="已确认的 DLC 标识">
              <textarea rows={3} value={dlcs} onChange={(e) => setDlcs(e.target.value)} />
            </Field>
          </div>
          <p className="muted compact">
            新卡 ID 使用本机日期时间、序列和随机数；游戏 GUID
            持久保存，更改范围只影响以后新增卡牌。
          </p>
        </details>
      </div>
      <footer className="modal-actions">
        <button className="button" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 1337471142 ||
            end > 2147483647 ||
            start > end
          }
          onClick={() => {
            onApply({
              ...project,
              name,
              dependencies: deps
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
              dlcs: dlcs
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
              guidRange: { ...project.guidRange, start, end },
            });
            onClose();
          }}
        >
          保存设置
        </button>
      </footer>
    </Modal>
  );
}
