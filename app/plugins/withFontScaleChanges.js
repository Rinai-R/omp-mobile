/**
 * Keep the activity when the system font size changes: Android recreates an
 * activity for a configuration change it does not declare, and a recreated
 * activity starts the app over at Home. With `fontScale` (and `density`, which
 * display-size changes bring with them) declared, the app stays where it is
 * and re-lays its text out at the new size itself (see App.tsx).
 */
const { withAndroidManifest } = require("expo/config-plugins");

const CHANGES = ["fontScale", "density"];

/** `android:configChanges` with `CHANGES` added, keeping what was there. */
function withChanges(value) {
  const present = String(value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const change of CHANGES) if (!present.includes(change)) present.push(change);
  return present.join("|");
}

module.exports = function withFontScaleChanges(config) {
  return withAndroidManifest(config, (next) => {
    const application = next.modResults.manifest.application?.[0];
    for (const activity of application?.activity ?? []) {
      if (activity.$?.["android:name"] !== ".MainActivity") continue;
      activity.$["android:configChanges"] = withChanges(activity.$["android:configChanges"]);
    }
    return next;
  });
};
module.exports.withChanges = withChanges;
