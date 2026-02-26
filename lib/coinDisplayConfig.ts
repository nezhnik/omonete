import fs from "fs";
import path from "path";

export type FirstImageSide = "obverse" | "reverse";

/** Какую сторону показывать первой. Читает coin-display-config.json из корня проекта. */
export function getFirstImageSide(): FirstImageSide {
  try {
    const p = path.join(process.cwd(), "coin-display-config.json");
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data.firstImage === "reverse" ? "reverse" : "obverse";
  } catch {
    return "obverse";
  }
}
