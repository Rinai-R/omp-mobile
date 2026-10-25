import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);

test("the activity keeps itself through a font size change", () => {
  const { withChanges } = require("../plugins/withFontScaleChanges.js");
  const prebuilt = "keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths";
  assert.equal(withChanges(prebuilt), `${prebuilt}|fontScale|density`);
  assert.equal(withChanges(`${prebuilt}|fontScale|density`), `${prebuilt}|fontScale|density`, "added once");
  assert.equal(withChanges(undefined), "fontScale|density");
  const app = require("../app.json");
  assert.ok(app.expo.plugins.includes("./plugins/withFontScaleChanges"));
});
