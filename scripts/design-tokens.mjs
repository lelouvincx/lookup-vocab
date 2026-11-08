import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { lint } from "@google/design.md/linter";

const report = lint(readFileSync("DESIGN.md", "utf8"));
if (report.summary.errors || report.summary.warnings)
  throw new Error("Fix DESIGN.md lint findings before exporting tokens.");
// The official native-CSS exporter handles colors, spacing and radii. Its 0.4
// export omits typography, so emit the official parsed typography values too.
const output = execFileSync(
  "designmd",
  ["export", "--format", "css-vars", "DESIGN.md"],
  { encoding: "utf8" },
);
const typography = [];
for (const [name, token] of report.designSystem.typography) {
  typography.push(`  --font-family-${name}: ${token.fontFamily};`);
  typography.push(
    `  --font-size-${name}: ${token.fontSize.value}${token.fontSize.unit};`,
  );
  typography.push(`  --font-weight-${name}: ${token.fontWeight};`);
  if (token.letterSpacing)
    typography.push(
      `  --letter-spacing-${name}: ${token.letterSpacing.value}${token.letterSpacing.unit};`,
    );
}
const css =
  "/* Generated from DESIGN.md by npm run design:tokens. Do not edit. */\n" +
  output.trimEnd() +
  "\n\n:root {\n" +
  typography.join("\n") +
  "\n}\n";
const path = "public/tokens.css";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== css)
    throw new Error("Design tokens changed. Run npm run design:tokens.");
} else writeFileSync(path, css);
