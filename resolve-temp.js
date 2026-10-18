const ts = require("typescript");
const fs = require("fs");
const s = ts.createSourceFile("index.tsx", fs.readFileSync("apps/customer/app/(shop)/(tabs)/index.tsx", "utf8"), ts.ScriptTarget.ESNext, true);
const m = ts.resolveModuleName("../../lib/cart-layout-metrics", s, { moduleResolution: ts.ModuleResolutionKind.Bundler, customConditions: ["react-native"], module: ts.ModuleKind.Preserve }, undefined);
console.log("resolved:", m.resolvedModule ? m.resolvedModule.resolvedFileName : "NOT RESOLVED");
