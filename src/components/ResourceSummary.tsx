import type { Catalog } from '../core/types.ts';

export function ResourceSummary({ catalog }: { catalog: Catalog }) {
  if (!catalog.indexedAt) return null;
  const report = catalog.scanReport;
  const counts = [
    ['生产建筑', catalog.assets.filter((a) => a.kind === 'building').length],
    ['商品', catalog.assets.filter((a) => a.kind === 'product').length],
    ['居民阶级', catalog.populations?.length ?? 0],
    ['商人', catalog.traders?.length ?? 0],
    ['游戏图标', catalog.portraits?.length ?? 0],
  ] as const;
  return (
    <section className="resource-result" aria-label="游戏资源读取结果">
      <h3>
        {!report
          ? '资源缓存需要重新读取'
          : report.status === 'partial'
            ? '部分资源未读完'
            : '游戏资源扫描完成'}
      </h3>
      <div className="resource-counts">
        {counts.map(([label, n]) => (
          <div key={label}>
            <strong>{n.toLocaleString()}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {report && (
        <p>
          归档读取 {report.archivesRead} / {report.archiveCount} 个；简体中文文本{' '}
          {report.chineseTexts.toLocaleString()} 条。
          {report.files.filter((f) => f.status === 'skipped').length
            ? `已分开处理 ${report.files.filter((f) => f.status === 'skipped').length} 个独立场景配置。`
            : ''}
        </p>
      )}
      {report?.status === 'partial' && (
        <p className="notice" role="alert">
          读取尚不完整，请查看下方失败项目或资源读取提示，再重新扫描。
        </p>
      )}
      <p className="muted compact">
        读取资源后可继续编辑卡牌。需要头像时，在“图片与头像”中点击选择。独立场景内容不会混入普通建筑列表。
      </p>
      {report && (
        <details className="advanced-details">
          <summary>查看读取明细</summary>
          {report.archives.map((a) => (
            <p className="break-path" key={a.path}>
              {a.status === 'read' ? '已读取' : '失败'} · {a.path.split(/[\\/]/).pop()}
              {a.message ? `：${a.message}` : ''}
            </p>
          ))}
          {report.files.map((f) => (
            <p className="break-path" key={f.path}>
              {f.status === 'read'
                ? `已读取 ${f.count.toLocaleString()} 条`
                : f.status === 'skipped'
                  ? '独立场景'
                  : '失败'}{' '}
              · {f.path} · {f.source.split(/[\\/]/).pop()}
              {f.message ? `：${f.message}` : ''}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
