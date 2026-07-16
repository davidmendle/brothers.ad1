export default function Brand({ className = "" }) {
  return (
    <span className={`brand ${className}`}>
      <span className="brand-logo-shell" aria-hidden="true">
        <img className="brand-logo" src="/logo.png" alt="" width="44" height="44" />
      </span>
      <span className="brand-copy">
        <strong>
          Brothers<sup>TM</sup>
        </strong>
        <span>.ad</span>
      </span>
    </span>
  );
}
