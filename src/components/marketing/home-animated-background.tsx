/**
 * Pure CSS/SVG animated backdrop for the marketing home page.
 * No client JS — waves loop via keyframes in globals.css.
 */
export function HomeAnimatedBackground() {
  return (
    <div className="home-animated-bg pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Black → deep green base */}
      <div className="home-animated-bg__base absolute inset-0" />

      {/* Slow drifting color orbs */}
      <div className="home-animated-bg__orb home-animated-bg__orb--a absolute" />
      <div className="home-animated-bg__orb home-animated-bg__orb--b absolute" />

      {/* Wave layers */}
      <div className="home-animated-bg__waves absolute inset-x-0 bottom-0">
        <div className="home-animated-bg__wave-track home-animated-bg__wave-track--slow">
          <WaveLayer wave="a" copy={0} opacity={0.14} />
          <WaveLayer wave="a" copy={1} opacity={0.14} />
        </div>
        <div className="home-animated-bg__wave-track home-animated-bg__wave-track--mid">
          <WaveLayer wave="b" copy={0} opacity={0.1} />
          <WaveLayer wave="b" copy={1} opacity={0.1} />
        </div>
        <div className="home-animated-bg__wave-track home-animated-bg__wave-track--fast">
          <WaveLayer wave="c" copy={0} opacity={0.07} />
          <WaveLayer wave="c" copy={1} opacity={0.07} />
        </div>
      </div>

      {/* Top vignette keeps text readable */}
      <div className="home-animated-bg__vignette absolute inset-0" />
    </div>
  );
}

function WaveLayer({
  wave,
  copy,
  opacity,
}: {
  wave: string;
  copy: number;
  opacity: number;
}) {
  const gradId = `home-wave-${wave}-${copy}`;
  return (
    <svg
      className="home-animated-bg__wave-svg"
      viewBox="0 0 1440 320"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgb(6, 78, 59)" stopOpacity={opacity} />
          <stop offset="50%" stopColor="rgb(16, 185, 129)" stopOpacity={opacity * 1.4} />
          <stop offset="100%" stopColor="rgb(5, 46, 22)" stopOpacity={opacity * 0.8} />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradId})`}
        d="M0,192L48,197.3C96,203,192,213,288,229.3C384,245,480,267,576,250.7C672,235,768,181,864,181.3C960,181,1056,235,1152,234.7C1248,235,1344,181,1392,154.7L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
      />
    </svg>
  );
}
