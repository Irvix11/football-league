"use client";

import React, { useState } from "react";
import { ArrowUpRight, Menu, Play, Sparkles, X } from "lucide-react";

export interface NavLink {
  label: string;
  href: string;
  isActive?: boolean;
}

export interface Partner {
  logoUrl: string;
  href: string;
  alt?: string;
}

export interface ResponsiveHeroBannerProps {
  logoUrl?: string;
  backgroundImageUrl?: string;
  navLinks?: NavLink[];
  ctaButtonText?: string;
  ctaButtonHref?: string;
  badgeText?: string;
  badgeLabel?: string;
  title?: string;
  titleLine2?: string;
  description?: string;
  primaryButtonText?: string;
  primaryButtonHref?: string;
  secondaryButtonText?: string;
  secondaryButtonHref?: string;
  partnersTitle?: string;
  partners?: Partner[];
  onCtaClick?: () => void;
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
}

const ResponsiveHeroBanner: React.FC<ResponsiveHeroBannerProps> = ({
  logoUrl,
  backgroundImageUrl =
    "https://images.unsplash.com/photo-1768861171882-9bbfed55b6f9?auto=format&fit=crop&w=2200&q=85",
  navLinks = [
    { label: "Home", href: "#", isActive: true },
    { label: "Modes", href: "#modes" },
    { label: "Features", href: "#features" },
  ],
  ctaButtonText = "Join Lobby",
  ctaButtonHref = "#join",
  badgeLabel = "LIVE",
  badgeText = "Realtime Auction • Tactical 2D Match Engine",
  title = "FOOTBALL",
  titleLine2 = "AUCTION LEAGUE",
  description =
    "Draft elite players, build your 11-player squad, outbid rival managers, set your tactics, and play the season.",
  primaryButtonText = "Solo Play",
  primaryButtonHref = "#solo",
  secondaryButtonText = "Create Lobby",
  secondaryButtonHref = "#create",
  partnersTitle = "",
  partners = [],
  onCtaClick,
  onPrimaryClick,
  onSecondaryClick,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleAction =
    (callback?: () => void, href = "#") =>
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!callback) return;
      event.preventDefault();
      callback();
      setMobileMenuOpen(false);
    };

  const logo = logoUrl ? (
    <img src={logoUrl} alt="Football Auction League" className="h-9 w-auto object-contain" />
  ) : (
    <span className="inline-flex h-10 items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-300/30 bg-emerald-400/10 text-emerald-300 shadow-lg shadow-emerald-500/10">
        <span className="text-sm font-black">F</span>
      </span>
      <span className="hidden sm:inline text-sm font-black tracking-[0.18em] text-white/90">
        FAL
      </span>
    </span>
  );

  return (
    <section className="relative isolate min-h-screen w-full overflow-hidden bg-[#02040a] text-white">
      <img
        src={backgroundImageUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        loading="eager"
        fetchPriority="high"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(1,8,7,.66)_0%,rgba(1,8,7,.52)_40%,rgba(1,4,7,.94)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(0,229,160,.16),transparent_38%)]" />
      <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10" />

      <header className="relative z-20">
        <div className="mx-auto max-w-7xl px-5 pt-5 sm:px-8">
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 backdrop-blur-xl">
            <a href="#" aria-label="Football Auction League home" className="shrink-0">
              {logo}
            </a>

            <nav className="hidden items-center gap-1 md:flex">
              <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-xl">
                {navLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className={`rounded-full px-3 py-2 text-xs font-bold transition-colors hover:bg-white/10 hover:text-white ${link.isActive ? "text-white" : "text-white/65"}`}
                  >
                    {link.label}
                  </a>
                ))}
                <a
                  href={ctaButtonHref}
                  onClick={handleAction(onCtaClick, ctaButtonHref)}
                  className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-200"
                >
                  {ctaButtonText}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </div>
            </nav>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white md:hidden"
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="mt-2 rounded-2xl border border-white/10 bg-[#07110f]/95 p-2 shadow-2xl backdrop-blur-xl md:hidden">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block rounded-xl px-4 py-3 text-sm font-bold text-white/80 hover:bg-white/5 hover:text-white"
                >
                  {link.label}
                </a>
              ))}
              <a
                href={ctaButtonHref}
                onClick={handleAction(onCtaClick, ctaButtonHref)}
                className="mt-1 flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-950"
              >
                {ctaButtonText}
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          )}
        </div>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-84px)] max-w-7xl items-center justify-center px-5 py-16 sm:px-8 sm:py-20">
        <div className="w-full max-w-4xl text-center">
          <div className="mb-6 inline-flex animate-fal-fade-1 items-center gap-2 rounded-full border border-emerald-300/20 bg-black/20 px-2.5 py-2 shadow-xl backdrop-blur-xl">
            <span className="rounded-full bg-emerald-300 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-950">
              {badgeLabel}
            </span>
            <span className="text-xs font-bold text-white/80 sm:text-sm">{badgeText}</span>
          </div>

          <h1 className="animate-fal-fade-2 font-serif text-5xl font-black leading-[0.9] tracking-[-0.045em] text-white drop-shadow-2xl sm:text-7xl md:text-8xl lg:text-9xl">
            {title}
            <br />
            <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-white bg-clip-text text-transparent">
              {titleLine2}
            </span>
          </h1>

          <p className="mx-auto mt-7 max-w-2xl animate-fal-fade-3 text-sm leading-7 text-white/70 sm:text-base md:text-lg">
            {description}
          </p>

          <div className="mt-9 flex animate-fal-fade-4 flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
            <a
              href={primaryButtonHref}
              onClick={handleAction(onPrimaryClick, primaryButtonHref)}
              className="group inline-flex min-w-44 items-center justify-center gap-2 rounded-full bg-emerald-400 px-6 py-3.5 text-sm font-black text-slate-950 shadow-2xl shadow-emerald-500/20 transition hover:-translate-y-0.5 hover:bg-emerald-300"
            >
              <Play className="h-4 w-4 fill-current" />
              {primaryButtonText}
            </a>
            <a
              href={secondaryButtonHref}
              onClick={handleAction(onSecondaryClick, secondaryButtonHref)}
              className="inline-flex min-w-44 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-black text-white backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/10"
            >
              {secondaryButtonText}
              <ArrowUpRight className="h-4 w-4" />
            </a>
            <a
              href={ctaButtonHref}
              onClick={handleAction(onCtaClick, ctaButtonHref)}
              className="inline-flex min-w-44 items-center justify-center gap-2 rounded-full border border-emerald-300/35 bg-emerald-400/10 px-6 py-3.5 text-sm font-black text-emerald-200 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-emerald-300/60 hover:bg-emerald-400/20 hover:text-white"
            >
              {ctaButtonText}
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>

          <div id="features" className="mt-14 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["LIVE", "Auction"],
              ["11", "Player Squads"],
              ["2–16", "Managers"],
              ["2D", "Match Engine"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-left backdrop-blur-xl"
              >
                <div className="text-lg font-black text-white sm:text-xl">{value}</div>
                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-white/45">{label}</div>
              </div>
            ))}
          </div>

          {partners.length > 0 && (
            <div id="modes" className="mx-auto mt-12 max-w-4xl">
              {partnersTitle && (
                <p className="mb-5 text-xs font-semibold text-white/50">{partnersTitle}</p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-3">
                {partners.map((partner, index) => (
                  <a
                    key={`${partner.href}-${index}`}
                    href={partner.href}
                    className="grid h-10 w-28 place-items-center rounded-full border border-white/10 bg-black/20 px-3 opacity-75 transition hover:opacity-100"
                  >
                    <img
                      src={partner.logoUrl}
                      alt={partner.alt ?? "Partner"}
                      className="max-h-6 max-w-full object-contain"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="mt-10 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
            <Sparkles className="h-3.5 w-3.5" />
            Built for fast mobile and desktop play
          </div>
        </div>
      </main>
    </section>
  );
};

export default ResponsiveHeroBanner;
