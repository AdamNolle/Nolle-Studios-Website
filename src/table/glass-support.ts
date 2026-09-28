/** SVG backdrop displacement renders black on Windows Chromium; keep CSS glass there. */
export const canRefract = (platform: string, brands: readonly string[]) =>
  /mac/i.test(platform) && brands.includes("Chromium");
