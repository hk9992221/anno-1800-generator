import { Compass } from 'lucide-react';
import type { Card, Catalog } from '../core/types.ts';
import { ALLOCATIONS, RARITIES, familyOf } from '../core/types.ts';
import { assetName } from '../core/catalog.ts';
import { Portrait } from './common.tsx';
import { EffectSummary } from './CardEditor.tsx';
export function CardPreview({
  card,
  catalog,
  refresh,
}: {
  card: Card;
  catalog?: Catalog;
  refresh: number;
}) {
  return (
    <article className={`game-card game-card-${card.rarity}`}>
      <div className="game-card-top">
        <span>ANNO 1800</span>
        <Compass size={18} />
      </div>
      <div className="game-card-art">
        <div className="art-orbit" />
        <Portrait image={card.image} size="large" refresh={refresh} />
        <span className="art-ribbon">{RARITIES[card.rarity]}</span>
      </div>
      <div className="game-card-content">
        <span className="game-card-allocation">{ALLOCATIONS[card.allocation]}</span>
        <h2>{card.name || '未命名专家'}</h2>
        {card.subtitle && <p className="game-card-subtitle">{card.subtitle}</p>}
        <div className="ornament">
          <span />✦<span />
        </div>
        <span className="tiny-label">影响目标</span>
        <p className="preview-targets">
          {familyOf(card.allocation) === 'ship'
            ? '装备本卡牌的船舶'
            : card.targets.length
              ? card.targets
                  .slice(0, 5)
                  .map((g) => assetName(catalog, g))
                  .join('、') +
                (card.targets.length > 5 ? ` 等 ${card.targets.length} 个目标` : '')
              : '尚未选择适用目标'}
        </p>
        <ul className="preview-effects">
          <EffectSummary card={card} catalog={catalog} />
        </ul>
        {card.description && <p className="flavor-text">“{card.description}”</p>}
        <div className="game-card-price">
          <span>购买价格</span>
          <strong>◈ {card.price.toLocaleString()}</strong>
        </div>
      </div>
    </article>
  );
}
