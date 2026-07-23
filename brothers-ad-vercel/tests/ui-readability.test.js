import fs from "fs";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function cssBlock(selectorStart) {
  const start = css.indexOf(selectorStart);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return open === -1 || close === -1 ? "" : css.slice(open + 1, close);
}

describe("UI readability guardrails", () => {
  it("allows primary buttons to wrap instead of forcing horizontal scanning", () => {
    const globalButtonBlock = cssBlock("button,\n.topbar-actions a");

    expect(globalButtonBlock).toContain("white-space: normal");
    expect(globalButtonBlock).not.toContain("white-space: nowrap");
    expect(globalButtonBlock).toContain("line-height: 1.2");
  });

  it("keeps the main shell labels calmer than all-caps dashboard chrome", () => {
    const shellLabelBlock = cssBlock(".screen-title span,\n.hero-band span");
    const sidebarLabelBlock = cssBlock(".sidebar-intro span");

    expect(shellLabelBlock).not.toContain("text-transform: uppercase");
    expect(shellLabelBlock).not.toContain("font-weight: 900");
    expect(sidebarLabelBlock).not.toContain("text-transform: uppercase");
    expect(sidebarLabelBlock).not.toContain("font-weight: 900");
  });
});
