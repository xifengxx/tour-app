export default function SealLogo({ size = 32, char = '巡', className = '' }) {
  return (
    <span
      className={`seal ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }}
      aria-hidden="true"
    >
      {char}
    </span>
  );
}
