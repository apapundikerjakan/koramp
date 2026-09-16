import clsx from 'clsx';

export type Asset = 'SOL' | 'ETH' | 'BNB';

const ASSET_INFO: Record<Asset, { name: string; network: string; color: string; bg: string; icon: string }> = {
  SOL: {
    name: 'Solana',
    network: 'Solana Network',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/20',
    icon: '◎',
  },
  ETH: {
    name: 'Ethereum',
    network: 'Base Network',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
    icon: 'Ξ',
  },
  BNB: {
    name: 'BNB',
    network: 'BNB Smart Chain',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
    icon: '⬡',
  },
};

interface AssetCardProps {
  asset: Asset;
  selected?: boolean;
  onClick?: () => void;
}

export function AssetCard({ asset, selected, onClick }: AssetCardProps) {
  const info = ASSET_INFO[asset];

  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-150 text-left',
        selected
          ? 'border-brand-500 bg-brand-600/10'
          : 'border-[#1e1e45] bg-[#111128] hover:border-[#2a2a5c] hover:bg-[#161635]'
      )}
      type="button"
    >
      <div className={clsx('w-12 h-12 rounded-xl border flex items-center justify-center text-xl font-bold', info.bg, info.color)}>
        {info.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={clsx('font-bold text-base', info.color)}>{asset}</span>
          {selected && (
            <span className="w-4 h-4 bg-brand-500 rounded-full flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </span>
          )}
        </div>
        <p className="text-gray-400 text-sm mt-0.5">{info.network}</p>
      </div>
    </button>
  );
}

export { ASSET_INFO };
