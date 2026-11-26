// @ts-nocheck
// Vendored MIT code. See LICENSE and SOURCE.json; regenerate with scripts/vendor-omp-form.mjs.
/** Behavior-compatible reimplementation of linkedom's used surface. */

import { DOMWindow } from "./dom/core.ts";
import { parseDocument } from "./dom/parser.ts";

export {
	Attr,
	Comment,
	CSSStyleDeclaration,
	CustomEvent,
	DOMTokenList,
	DOMWindow,
	Document,
	DocumentFragment,
	Element,
	Event,
	EventTarget,
	HTMLElement,
	HTMLIFrameElement,
	HTMLMetaElement,
	HTMLTemplateElement,
	NamedNodeMap,
	Node,
	NodeType,
	SVGElement,
	serializeNode,
	Text,
} from "./dom/core.ts";

/** Parse HTML or XML-like markup into a lightweight window and document. */
export function parseHTML(html: string): DOMWindow {
	return new DOMWindow(parseDocument(html));
}
