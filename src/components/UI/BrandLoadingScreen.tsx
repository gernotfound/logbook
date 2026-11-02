type BrandLoadingScreenProps = {
  variant?: 'fullscreen' | 'content';
  label?: string;
};

const BRAND_LOADING_ARTWORK_SRC = `${import.meta.env.BASE_URL}loading-wait.svg?v=20261007-waiting-mascot`;

export default function BrandLoadingScreen({
  variant = 'fullscreen',
  label = 'Caricamento in corso',
}: BrandLoadingScreenProps) {
  const className = variant === 'content'
    ? 'brand-loading-screen brand-loading-screen--content'
    : 'brand-loading-screen';

  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="brand-loading-screen__brand" aria-hidden="true">
        <img
          className="brand-loading-screen__mascot"
          src={BRAND_LOADING_ARTWORK_SRC}
          alt=""
          fetchPriority={variant === 'fullscreen' ? 'high' : 'auto'}
        />
        <div className="brand-loading-screen__wordmark">
          <h1>CARICAMENT<span className="brand-loading-screen__spinner" aria-hidden="true" /></h1>
        </div>
      </div>
    </div>
  );
}
