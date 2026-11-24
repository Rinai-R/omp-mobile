import assert from "node:assert/strict";
import { test } from "node:test";
import { singleChoiceForm } from "../src/askForm.ts";

test("a title-less RPC form uses the legend and submits the input name and value", () => {
  const html = `<form><fieldset><legend>Which route?</legend><p>Pick one.</p>
    <label><input type="radio" name="route" value="direct">Direct</label>
    <label><input type="radio" name="route" value="relay">Relay</label>
  </fieldset></form>`;
  assert.deepEqual(singleChoiceForm(html), {
    name: "route",
    question: "Which route?",
    prompt: "Pick one.",
    choices: [{ value: "direct", label: "Direct" }, { value: "relay", label: "Relay" }],
  });
});

test("missing and unsupported forms do not produce a partial answer", () => {
  assert.equal(singleChoiceForm(undefined), undefined);
  assert.equal(singleChoiceForm("<p>No form</p>"), undefined);
  assert.equal(singleChoiceForm('<form><input type="checkbox" name="extra" value="yes"></form>'), undefined);
  assert.equal(singleChoiceForm('<form><input type="radio" name="route" value="relay"><input name="note"></form>'), undefined);
});
