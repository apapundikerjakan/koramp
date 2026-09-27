'use client';

/**
 * EcosystemMarquee — premium infinite logo strip (KORAMP landing).
 *
 * ALL brand artwork below is the actual official asset, served locally from
 * /public/logos (no hotlinking, no recreation):
 * - Solana: full horizontal lockup SVG from https://solana.com/branding
 * - Base: white lockup SVG from the official Base brand kit (brand.base.org)
 * - BNB Chain: lockup SVG from official BNB Chain docs (docs.bnbchain.org)
 * - Blockchain.com: lockup SVG from Blockchain.com's own GitHub repo
 * - Xendit: text badge (no logo asset)
 * - IDR: neutral "Rp" currency badge (not a company logo)
 *
 * Artwork is never altered: only display height is normalized (width auto,
 * exact aspect ratios preserved), plus opacity for dark-theme integration.
 * Track holds the sequence twice and translates exactly -50%: a seamless
 * endless loop. Hover pauses in place; reduced motion shows a stable row.
 */

interface Item {
  id: string;
  label: string;
  href: string | null;
  src?: string;
  width: number;
  height: number;
}

const ITEMS: Item[] = [
  { id: 'xendit', label: 'Xendit', href: 'https://www.xendit.co/', width: 0, height: 0 },
  { id: 'blockchain', label: 'Blockchain.com', href: 'https://www.blockchain.com/', src: '/logos/blockchaincom.svg', width: 432, height: 48 },
  { id: 'solana', label: 'Solana', href: 'https://solana.com/', src: '/logos/solana.svg', width: 646, height: 96 },
  { id: 'base', label: 'Base', href: 'https://www.base.org/', src: '/logos/base.svg', width: 1280, height: 324 },
  { id: 'bnb', label: 'BNB Chain', href: 'https://www.bnbchain.org/', src: '/logos/bnbchain.svg', width: 137, height: 24 },
  { id: 'idr', label: 'Indonesian Rupiah', href: null, width: 0, height: 0 },
];

function LogoItem({ id, label, href, src, width, height }: Item) {
  // Intrinsic-width flex item: the whole mark + gap + wordmark must reserve
  // its own width. Nothing here may shrink, clip, or collapse.
  const cls =
    'ecosystem-logo flex items-center gap-2.5 sm:gap-3 shrink-0 min-w-max opacity-75 transition-all duration-200 hover:opacity-100 hover:scale-[1.04] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4B78F]/60 rounded-lg px-1';
  // Normalized visual height (~28px, BNB slightly smaller to balance its
  // compact lockup); width follows the official aspect ratio exactly.
  const h = id === 'bnb' ? 24 : 28;
  const w = src ? Math.round((width / height) * h) : 0;
  const inner = (
    <>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" aria-hidden width={w} height={h} style={{ height: h, width: 'auto', flexShrink: 0 }} draggable={false} />
      ) : (
        <span aria-hidden className="flex items-center justify-center rounded-full border border-[#D4B78F]/50 bg-[#D4B78F]/10 text-[#D4B78F] text-xs sm:text-sm font-bold" style={{ height: h, width: h, flexShrink: 0 }}>
          {id === 'xendit' ? 'X' : 'Rp'}
        </span>
      )}
      {(id === 'idr' || id === 'xendit') && (
        <span
          style={{
            color: '#CFCFD4',
            opacity: 1,
            fontSize: 15,
            lineHeight: '20px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            overflow: 'visible',
            maxWidth: 'none',
          }}
        >
          {id === 'idr' ? 'Rupiah' : 'Xendit'}
        </span>
      )}
    </>
  );
  if (!href) {
    return (
      <span className={cls} role="img" aria-label={label}>
        {inner}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={`${cls} cursor-pointer`}>
      {inner}
    </a>
  );
}

export function EcosystemMarquee() {
  return (
    <div
      className="ecosystem-marquee overflow-hidden"
      role="region"
      aria-label="Ekosistem dan partner KORAMP"
    >
      <div className="ecosystem-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="ecosystem-seq">
            {ITEMS.map((item) => (
              <LogoItem key={`${copy}-${item.id}`} {...item} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
