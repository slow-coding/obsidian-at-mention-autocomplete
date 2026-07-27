import esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  external: ["obsidian", "@codemirror/view", "@codemirror/state", "@codemirror/autocomplete", "@codemirror/language"],
  outfile: "main.js",
  sourcemap: isWatch ? "inline" : false,
});

if (isWatch) {
  await ctx.watch();
  console.log("watching...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
