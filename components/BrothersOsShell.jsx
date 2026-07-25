"use client";

import Script from "next/script";

export default function BrothersOsShell() {
  return (
    <>
      <link rel="stylesheet" href="/styles.css" />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            body { margin: 0; background: #f4f7fb; }
            body > header.nav,
            body > footer,
            body > button.chat,
            body > aside.chat-panel { display: none !important; }
          `
        }}
      />
      <div id="app" suppressHydrationWarning />
      <Script id="brothers-os-runtime" type="module" src="/app.js" strategy="afterInteractive" />
    </>
  );
}
