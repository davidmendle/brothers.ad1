import fs from "fs";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function uniqueMatches(pattern) {
  return Array.from(new Set([...source.matchAll(pattern)].map((match) => match[1]))).sort();
}

describe("UI action inventory", () => {
  it("handles every rendered data-action value", () => {
    const renderedActions = uniqueMatches(/data-action=\"([^\"]+)\"/g);
    const directHandlers = uniqueMatches(/if \(action === \"([^\"]+)\"\)/g);
    const groupedHandlers = [...source.matchAll(/if \(([^)]*action ===[^)]*)\)/g)]
      .flatMap((match) => [...match[1].matchAll(/action === \"([^\"]+)\"/g)].map((item) => item[1]));
    const handledActions = Array.from(new Set([...directHandlers, ...groupedHandlers])).sort();
    const missing = renderedActions.filter((action) => !handledActions.includes(action));

    expect(renderedActions.length).toBeGreaterThan(60);
    expect(missing).toEqual([]);
  });

  it("keeps the communication board and global index modules routable", () => {
    expect(source).toContain('if (module.key === "communications") return renderCommunicationsModule(module);');
    expect(source).toContain('if (module.key === "globalindexes") return renderGlobalIndexesModule(module);');
    expect(source).toContain('function renderGlobalBusinessIndexPanel()');
    expect(source).toContain('function renderCommunityPost(post)');
  });
});
