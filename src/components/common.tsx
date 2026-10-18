import { useEffect, useState, type ReactNode } from 'react';
import { UserRound, X } from 'lucide-react';
import type { Card, CardImage } from '../core/types.ts';
import { native } from '../native.ts';
export function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = old;
    };
  }, [onClose]);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">CARD WORKSHOP</span>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
            <X size={21} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
const portraitCache = new Map<string, string>();
let portraitWorkers = 0;
const portraitQueue: (() => void)[] = [];
function queuedPortrait(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const run = () => {
      portraitWorkers++;
      native
        .portrait(path)
        .catch(() => null)
        .then(resolve)
        .finally(() => {
          portraitWorkers--;
          portraitQueue.shift()?.();
        });
    };
    if (portraitWorkers < 4) run();
    else portraitQueue.push(run);
  });
}
const portraitRequests = new Map<string, Promise<string | null>>();
export function Portrait({
  image,
  size = 'normal',
  refresh = 0,
}: {
  image: CardImage;
  size?: 'mini' | 'normal' | 'large';
  refresh?: number | string;
}) {
  const key = image.mode === 'custom' ? image.data : `${refresh}:${image.path}`;
  const [url, setUrl] = useState<string | undefined>(
    image.mode === 'custom' ? image.data : portraitCache.get(key ?? ''),
  );
  useEffect(() => {
    let live = true;
    if (image.mode === 'custom') {
      setUrl(image.data);
      return;
    }
    const cacheKey = `${refresh}:${image.path}`;
    setUrl(portraitCache.get(cacheKey));
    if (image.path && !portraitCache.has(cacheKey)) {
      if (!portraitRequests.has(cacheKey))
        portraitRequests.set(
          cacheKey,
          queuedPortrait(image.path).finally(() => portraitRequests.delete(cacheKey)),
        );
      portraitRequests.get(cacheKey)!.then((u) => {
        if (u) {
          portraitCache.set(cacheKey, u);
          if (portraitCache.size > 300)
            portraitCache.delete(portraitCache.keys().next().value!);
          if (live) setUrl(u);
        }
      });
    }
    return () => {
      live = false;
    };
  }, [key, refresh]);
  return (
    <div className={`portrait portrait-${size}`}>
      {url ? (
        <img src={url} alt="卡牌头像" loading="lazy" />
      ) : (
        <>
          <UserRound strokeWidth={1.1} />
          {size !== 'mini' && <span>选择头像</span>}
        </>
      )}
    </div>
  );
}
export function CardBadge({ card }: { card: Card }) {
  return (
    <span className={`rarity-tag rarity-${card.rarity}`}>
      {
        {
          Common: '普通',
          Uncommon: '非凡',
          Rare: '稀有',
          Epic: '史诗',
          Legendary: '传奇',
        }[card.rarity]
      }
    </span>
  );
}
export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <p>{children}</p>
    </div>
  );
}
