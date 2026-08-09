import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

const repoRoot = resolve(import.meta.dirname, "..");

describe("dansk lokalisering", () => {
  it("har danske UI-tekster i centrale knapper og beskeder", () => {
    const html = readFileSync(resolve(repoRoot, "index.html"), "utf8");
    const dom = new JSDOM(html);
    const { document } = dom.window;

    expect(document.documentElement.lang).toBe("da");
    expect(document.querySelector("#cameraButton")?.textContent).toContain("Start kamera");
    expect(document.querySelector("#stopCameraButton")?.textContent).toContain("Stop kamera");
    expect(document.querySelector("#statusBanner")?.textContent).toContain("Vælg en brille");
    expect(document.body.textContent).toMatch(/[æøåÆØÅ]/);
  });

  it("undgår æøå-fri fallbacktekster i app-logik", () => {
    const appSource = readFileSync(resolve(repoRoot, "app.js"), "utf8");

    expect(appSource).not.toMatch(/\b(Vaelg|Proev|laest|soegning|overlaeg|foelge|fortsaette)\b/);
  });
});
