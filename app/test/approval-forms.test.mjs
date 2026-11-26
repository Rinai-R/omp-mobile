import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalForm,
  initialApprovalDraft,
  formData,
  approvalResponse,
  setChoice,
  approvalErrors,
  hasSensitiveFields,
  approvalIdentity,
} from "../src/approvalForms.ts";
import { queueApproval, resolveApproval } from "../src/approvalQueue.ts";
const request = {
  id: "f",
  method: "form",
  html: '<form><fieldset><legend>Release</legend><p>Read everything</p><label><input type="radio" name="route" value="direct" checked>Direct</label><label><input type="radio" name="route" value="relay">Relay</label><label><input type="radio" name="route" value="disabled" disabled>Disabled</label><label><input type="checkbox" name="scope" value="app" checked>App</label><label><input type="checkbox" name="scope" value="daemon">Daemon</label><label>Replicas<input name="replicas" type="number" value="2" min="1" max="5" required></label><textarea name="notes" required></textarea><input type="hidden" name="token" value="fixed"></fieldset></form>',
};
test("multi-field form preserves names, disabled options, hidden data and numeric types", () => {
  const f = approvalForm(request);
  let d = initialApprovalDraft(request, f);
  assert.equal(f.sections[0].blocks[0].kind, "text");
  assert.equal(setChoice(d, f.fields[0], 2), d);
  d = setChoice(d, f.fields[0], 1);
  d = setChoice(d, f.fields[1], 1);
  d.values.notes = "中文";
  assert.deepEqual(
    { ...formData(f, d) },
    {
      token: "fixed",
      route: "relay",
      scope: ["app", "daemon"],
      replicas: 2,
      notes: "中文",
    },
  );
  assert.deepEqual(approvalResponse(request, f, d), { data: formData(f, d) });
});
test("required and numeric errors block incomplete answers", () => {
  const f = approvalForm(request),
    d = initialApprovalDraft(request, f);
  assert.equal(approvalErrors(f, d).notes, "Required");
  d.values.replicas = "9";
  assert.match(approvalErrors(f, d).replicas, /at most 5/);
});
test("Other replaces single choice and can join a multi choice", () => {
  const f = approvalForm(request);
  const d = initialApprovalDraft(request, f);
  d.checked.route = [];
  d.usingOther.route = true;
  d.others.route = "custom";
  d.usingOther.scope = true;
  d.others.scope = "tests";
  assert.equal(formData(f, d).route, "custom");
  assert.deepEqual(formData(f, d).scope, ["app", "tests"]);
});
test("ask answers retain question order, single-item multi arrays and custom text", () => {
  const r = {
    id: "ask",
    method: "ask",
    questions: [
      {
        id: "a",
        question: "Scope",
        multi: true,
        options: [{ label: "App" }],
        recommended: 0,
      },
      { id: "b", question: "Route", options: [{ label: "Direct" }] },
    ],
  };
  const f = approvalForm(r),
    d = initialApprovalDraft(r, f);
  d.usingOther.b = true;
  d.others.b = " Relay ";
  assert.deepEqual(approvalResponse(r, f, d), {
    answers: [
      { id: "a", selectedOptions: ["App"] },
      { id: "b", selectedOptions: [], customInput: "Relay" },
    ],
  });
});
test("password forms are never persisted; request identity ignores only transport timing", () => {
  const r = {
    ...request,
    html: '<form><input type="password" name="secret"></form>',
  };
  assert.ok(hasSensitiveFields(r, approvalForm(r)));
  assert.equal(
    approvalIdentity(request),
    approvalIdentity({ ...request, receivedAt: 123, expiresAt: 456 }),
  );
  assert.notEqual(
    approvalIdentity(request),
    approvalIdentity({ ...request, html: "different" }),
  );
});
test("queue does not replace an earlier question and resolves only the matching ID", () => {
  const a = { id: "a", method: "confirm" },
    b = { id: "b", method: "input" };
  const q = queueApproval(queueApproval([], a), b);
  assert.deepEqual(
    queueApproval(q, { ...a, title: "Updated" }).map((r) => r.id),
    ["a", "b"],
  );
  assert.deepEqual(resolveApproval(q, "a"), [b]);
  assert.deepEqual(resolveApproval(q, "unknown"), q);
});

test("HTML names that shadow object properties remain ordinary fields", () => {
  const r = {
    id: "special",
    method: "form",
    html: '<form><label><input type="radio" name="__proto__" value="yes">Yes</label><label><input type="radio" name="__proto__" value="no">No</label><input name="constructor" value="text"></form>',
  };
  const f = approvalForm(r);
  let d = initialApprovalDraft(r, f);
  assert.equal(d.usingOther.__proto__, undefined);
  assert.equal(d.others.__proto__, undefined);
  d = setChoice(d, f.fields[0], 0);
  const data = formData(f, d);
  assert.equal(data.__proto__, "yes");
  assert.equal(data.constructor, "text");
  assert.deepEqual(approvalErrors(f, d), {});
});
