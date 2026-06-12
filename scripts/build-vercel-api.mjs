import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["server/app.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "api/index.js",
  packages: "external",
  footer: {
    js: "export const config = { maxDuration: 60 };",
  },
});

console.log("API bundle → api/index.js");
