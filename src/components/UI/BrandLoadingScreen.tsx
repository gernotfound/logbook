type BrandLoadingScreenProps = {
  variant?: 'fullscreen' | 'content';
  label?: string;
};

const BRAND_ICON_SRC = `${import.meta.env.BASE_URL}icon.svg?v=20261006-vector-master`;

export default function BrandLoadingScreen({
  variant = 'fullscreen',
  label = 'Avvio di TheLogBook in corso',
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
          className="brand-loading-screen__icon"
          src={BRAND_ICON_SRC}
          alt=""
          fetchPriority={variant === 'fullscreen' ? 'high' : 'auto'}
        />
        <div className="brand-loading-screen__wordmark" data-text="TheLogBook">
          <h1>TheLogBook</h1>
        </div>
      </div>
    </div>
  );
}
