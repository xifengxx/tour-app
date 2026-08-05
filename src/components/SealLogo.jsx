export default function SealLogo({ size = 32, char = '巡', animate = false, className = '' }) {
  return (
    <span
      className={`seal ${animate ? 'anim-stamp' : ''} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }}
      aria-hidden="true"
    >
      {char}
    </span>
  );
}
