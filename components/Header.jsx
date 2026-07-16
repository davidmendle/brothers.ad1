"use client";

import { useEffect, useState } from "react";
import Brand from "./Brand";

const navItems = [
  ["AI Products", "/#products"],
  ["Solutions", "/#solutions"],
  ["Pricing", "/#pricing"],
  ["Industries", "/#industries"],
  ["Blog", "/blog"],
  ["About", "/#about"]
];

export default function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function closeMenu() {
      setOpen(false);
    }
    window.addEventListener("brothers-ad-chat-open", closeMenu);
    return () => window.removeEventListener("brothers-ad-chat-open", closeMenu);
  }, []);

  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <a href="/" aria-label="Brothers.ad home">
          <Brand />
        </a>
        <nav className="nav-links" aria-label="Main navigation">
          {navItems.map(([label, href]) => (
            <a key={label} href={href}>
              {label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <a className="restoration-link" href="https://brothersrestoration.org/">
            Brothers Restoration
          </a>
          <a className="btn primary small" href="/#contact">
            Book AI Audit
          </a>
        </div>
        <button
          className="menu-button"
          type="button"
          aria-label="Open navigation menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
      {open ? (
        <div className="mobile-menu">
          {navItems.map(([label, href]) => (
            <a key={label} href={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <a href="https://brothersrestoration.org/" onClick={() => setOpen(false)}>
            Brothers Restoration
          </a>
          <a className="btn primary" href="/#contact" onClick={() => setOpen(false)}>
            Book AI Audit
          </a>
        </div>
      ) : null}
    </header>
  );
}
