import React from 'react';

interface PitchGraphicProps {
  className?: string;
  children?: React.ReactNode;
  aspectRatio?: 'vertical' | 'horizontal';
  showMarkings?: boolean;
}

export const PitchGraphic: React.FC<PitchGraphicProps> = ({
  className = '',
  children,
  aspectRatio = 'vertical',
  showMarkings = true,
}) => {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-emerald-500/20 pitch-pattern shadow-2xl ${className}`}
      style={{
        aspectRatio: aspectRatio === 'vertical' ? '68 / 105' : '105 / 68',
      }}
    >
      {/* Stadium floodlight radial glows */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-emerald-400/10 via-transparent to-emerald-950/40" />

      {showMarkings && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          fill="none"
          stroke="rgba(255, 255, 255, 0.35)"
          strokeWidth="0.75"
        >
          {aspectRatio === 'vertical' ? (
            <>
              {/* Pitch Boundary */}
              <rect x="5" y="4" width="90" height="92" rx="1.5" />
              {/* Half-Way Line */}
              <line x1="5" y1="50" x2="95" y2="50" />
              {/* Center Circle */}
              <circle cx="50" cy="50" r="10.5" />
              <circle cx="50" cy="50" r="0.8" fill="rgba(255,255,255,0.7)" />

              {/* Top Penalty Box (Away/Opponent) */}
              <rect x="24" y="4" width="52" height="17" />
              <rect x="36" y="4" width="28" height="6" />
              <circle cx="50" cy="13" r="0.7" fill="rgba(255,255,255,0.7)" />
              <path d="M 39 21 A 10.5 10.5 0 0 0 61 21" />

              {/* Bottom Penalty Box (Home/User) */}
              <rect x="24" y="79" width="52" height="17" />
              <rect x="36" y="90" width="28" height="6" />
              <circle cx="50" cy="87" r="0.7" fill="rgba(255,255,255,0.7)" />
              <path d="M 39 79 A 10.5 10.5 0 0 1 61 79" />

              {/* Goal Posts */}
              <rect x="42" y="2" width="16" height="2" fill="rgba(255,255,255,0.8)" stroke="none" />
              <rect x="42" y="96" width="16" height="2" fill="rgba(255,255,255,0.8)" stroke="none" />
            </>
          ) : (
            <>
              {/* Horizontal layout (e.g. Live match view) */}
              {/* Boundary */}
              <rect x="4" y="5" width="92" height="90" rx="1.5" />
              {/* Halfway line */}
              <line x1="50" y1="5" x2="50" y2="95" />
              {/* Center circle */}
              <circle cx="50" cy="50" r="10.5" />
              <circle cx="50" cy="50" r="0.8" fill="rgba(255,255,255,0.7)" />

              {/* Left Penalty Area (Home) */}
              <rect x="4" y="24" width="17" height="52" />
              <rect x="4" y="36" width="6" height="28" />
              <circle cx="13" cy="50" r="0.7" fill="rgba(255,255,255,0.7)" />
              <path d="M 21 39 A 10.5 10.5 0 0 1 21 61" />

              {/* Right Penalty Area (Away) */}
              <rect x="79" y="24" width="17" height="52" />
              <rect x="90" y="36" width="6" height="28" />
              <circle cx="87" cy="50" r="0.7" fill="rgba(255,255,255,0.7)" />
              <path d="M 79 39 A 10.5 10.5 0 0 0 79 61" />

              {/* Goals */}
              <rect x="2" y="42" width="2" height="16" fill="rgba(255,255,255,0.8)" stroke="none" />
              <rect x="96" y="42" width="2" height="16" fill="rgba(255,255,255,0.8)" stroke="none" />
            </>
          )}
        </svg>
      )}

      {children}
    </div>
  );
};
