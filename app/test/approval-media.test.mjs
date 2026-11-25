import assert from "node:assert/strict";
import { test } from "node:test";
import {
  remoteFormImage,
  sanitizeSvgTree,
  svgDataMarkup,
  svgTreeMarkup,
} from "../src/approvalMedia.ts";
const node = (props, children = []) => ({ tag: "svg", props, children });

test("remote form sources become explicit HTTP links, including protocol-relative and whitespace variants", () => {
  for (const src of [
    "http://example.com/a.png",
    " HTTPS://example.com/a.svg ",
    "//example.com/a.png",
    "ht\ntps://example.com/a.png",
  ])
    assert.match(remoteFormImage(src), /^https?:\/\/example.com\//);
  for (const src of [
    "local.png",
    "data:image/png;base64,YQ==",
    "blob:sha256:" + "a".repeat(64),
    "file:///outside.png",
  ])
    assert.equal(remoteFormImage(src), undefined);
});
test("the renderer AST loses every external href alias while preserving viewBox, fragments and data", () => {
  const data = "data:image/png;base64,aGk=";
  const tree = node({ viewBox: "0 0 100 100" }, [
    node({ href: "http://example.com/pixel.png" }),
    node({ xlinkHref: "//example.com/pixel.svg" }),
    node({ "XLINK:HREF": " HtTpS://example.com/track " }),
    node({ href: "relative.png" }),
    node({ href: "file:///phone/private.png" }),
    node({ href: "h&#116;tp://example.com/entity.png" }),
    node({ href: "#gradient" }),
    node({ href: data }),
  ]);
  const result = sanitizeSvgTree(tree, () => undefined);
  assert.equal(result.tree.props.viewBox, "0 0 100 100");
  for (const child of tree.children.slice(0, 6))
    assert.deepEqual(child.props, {});
  assert.equal(tree.children[6].props.href, "#gradient");
  assert.equal(tree.children[7].props.href, data);
  assert.deepEqual(result.links, [
    "http://example.com/pixel.png",
    "https://example.com/pixel.svg",
    "https://example.com/track",
  ]);
  const serialized = svgTreeMarkup(tree);
  assert.match(serialized, /viewBox="0 0 100 100"/);
  assert.doesNotMatch(serialized, /example\.com|private\.png|relative\.png/);
});
test("embedded SVG data references must pass the recursive sanitizer before rendering", () => {
  const nested =
    "data:image/svg+xml," +
    encodeURIComponent('<svg><image href="https://example.com"/></svg>');
  const tree = node({ href: nested });
  let seen;
  sanitizeSvgTree(tree, (uri) => {
    seen = svgDataMarkup(uri);
    return "data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E";
  });
  assert.equal(seen, '<svg><image href="https://example.com"/></svg>');
  assert.equal(tree.props.href, "data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E");
  const base64 =
    "data:image/svg+xml;base64," +
    Buffer.from("<svg>中文</svg>").toString("base64");
  assert.equal(svgDataMarkup(base64), "<svg>中文</svg>");
});
