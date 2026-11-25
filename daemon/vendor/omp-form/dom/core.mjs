// @ts-nocheck
// Vendored MIT code. See LICENSE and SOURCE.json; regenerate with scripts/vendor-omp-form.mjs.
/** Behavior-compatible reimplementation of linkedom's used surface. */
import { parseFragment, parseInto } from "./parser.mjs";
import { closestMatching, hasClassToken, matchesSelector, querySelectorAllFrom, querySelectorFrom } from "./selector.mjs";
/** DOM node type constants. */
export const NodeType = {
    ELEMENT: 1,
    ATTRIBUTE: 2,
    TEXT: 3,
    COMMENT: 8,
    DOCUMENT: 9,
    DOCUMENT_FRAGMENT: 11,
};
/** Minimal browser event implementation. */
export class Event {
    type;
    bubbles;
    cancelable;
    target = null;
    currentTarget = null;
    defaultPrevented = false;
    #stopped = false;
    constructor(type, init = {}) {
        this.type = type;
        this.bubbles = init.bubbles ?? false;
        this.cancelable = init.cancelable ?? false;
    }
    /** Initialize an event created through Document.createEvent. */
    initEvent(type, bubbles = false, cancelable = false) {
        this.type = type;
        this.bubbles = bubbles;
        this.cancelable = cancelable;
        this.defaultPrevented = false;
    }
    /** Cancel this event when it is cancelable. */
    preventDefault() {
        if (this.cancelable)
            this.defaultPrevented = true;
    }
    /** Stop bubbling this event. */
    stopPropagation() {
        this.#stopped = true;
    }
    /** Whether propagation has been stopped. */
    get propagationStopped() {
        return this.#stopped;
    }
}
/** Browser custom event carrying a detail value. */
export class CustomEvent extends Event {
    detail;
    constructor(type, init = {}) {
        super(type, init);
        this.detail = init.detail;
    }
}
/** Minimal event-target implementation used by DOM nodes and window. */
export class EventTarget {
    /** Allocated on the first `addEventListener`; most nodes never get listeners. */
    #listeners;
    /** Register an event listener. */
    addEventListener(type, listener) {
        if (!listener)
            return;
        const listenerMap = (this.#listeners ??= new Map());
        let listeners = listenerMap.get(type);
        if (!listeners) {
            listeners = new Set();
            listenerMap.set(type, listeners);
        }
        listeners.add(listener);
    }
    /** Remove an event listener. */
    removeEventListener(type, listener) {
        if (listener)
            this.#listeners?.get(type)?.delete(listener);
    }
    /** Dispatch an event to listeners and optionally through node ancestors. */
    dispatchEvent(event) {
        if (!event.target)
            event.target = this;
        event.currentTarget = this;
        const listeners = this.#listeners?.get(event.type);
        for (const listener of listeners ? Array.from(listeners) : []) {
            if (typeof listener === "function")
                listener.call(this, event);
            else
                listener.handleEvent(event);
            if (event.propagationStopped)
                break;
        }
        if (event.bubbles && !event.propagationStopped && this instanceof Node && this.parentNode) {
            this.parentNode.dispatchEvent(event);
        }
        return !event.defaultPrevented;
    }
}
/** Index of a node in its parent's `childNodes`, or -1; bound to Node's private index hint. */
let indexInParent;
/** Base class for the implemented DOM tree. */
export class Node extends EventTarget {
    static ELEMENT_NODE = NodeType.ELEMENT;
    static ATTRIBUTE_NODE = NodeType.ATTRIBUTE;
    static TEXT_NODE = NodeType.TEXT;
    static COMMENT_NODE = NodeType.COMMENT;
    static DOCUMENT_NODE = NodeType.DOCUMENT;
    static DOCUMENT_FRAGMENT_NODE = NodeType.DOCUMENT_FRAGMENT;
    nodeType;
    nodeName;
    parentNode = null;
    ownerDocument;
    /** Allocated on first access or insertion, so leaf nodes (text, comments, attributes) usually never allocate. */
    #childNodes;
    /** Last known index in the parent's `childNodes`; always verified before use, so a stale value only costs a rescan. */
    #index = 0;
    static {
        indexInParent = node => {
            const siblings = node.#siblings();
            return siblings ? node.#indexIn(siblings) : -1;
        };
    }
    constructor(nodeType, nodeName, ownerDocument = null) {
        super();
        this.nodeType = nodeType;
        this.nodeName = nodeName;
        this.ownerDocument = ownerDocument;
    }
    /** Child nodes in tree order. */
    get childNodes() {
        this.#childNodes ??= [];
        return this.#childNodes;
    }
    set childNodes(value) {
        this.#childNodes = value;
    }
    /** Whether this node has any children (without allocating a child list). */
    hasChildNodes() {
        return this.#childNodes !== undefined && this.#childNodes.length > 0;
    }
    /** First child node, if present. */
    get firstChild() {
        return this.#childNodes?.[0] ?? null;
    }
    /** Last child node, if present. */
    get lastChild() {
        const children = this.#childNodes;
        return children ? (children[children.length - 1] ?? null) : null;
    }
    /** Previous node with the same parent. */
    get previousSibling() {
        const siblings = this.#siblings();
        if (!siblings)
            return null;
        const index = this.#indexIn(siblings);
        return index > 0 ? siblings[index - 1] : null;
    }
    /** Next node with the same parent. */
    get nextSibling() {
        const siblings = this.#siblings();
        if (!siblings)
            return null;
        const index = this.#indexIn(siblings);
        return index >= 0 ? (siblings[index + 1] ?? null) : null;
    }
    /** The parent's child list, without allocating one. */
    #siblings() {
        const parent = this.parentNode;
        return parent ? parent.#childNodes : undefined;
    }
    /** Locate this node in `siblings` via the index hint, re-indexing all siblings on a miss. */
    #indexIn(siblings) {
        const hint = this.#index;
        if (siblings[hint] === this)
            return hint;
        if (siblings[hint + 1] === this)
            return ++this.#index;
        if (hint > 0 && siblings[hint - 1] === this)
            return --this.#index;
        let found = -1;
        for (let index = 0; index < siblings.length; index++) {
            const sibling = siblings[index];
            sibling.#index = index;
            if (found < 0 && sibling === this)
                found = index;
        }
        if (found >= 0)
            this.#index = found;
        return found;
    }
    /** Index of a child in this node's `childNodes`, or -1. */
    #childIndex(child) {
        const children = this.#childNodes;
        if (!children)
            return -1;
        return child?.parentNode === this ? child.#indexIn(children) : children.indexOf(child);
    }
    /** Move every child of a fragment into this node at `index` (append for null). */
    #adoptChildren(fragment, index) {
        const moved = fragment.#childNodes;
        if (!moved?.length)
            return;
        if (moved.some(nested => nested.parentNode !== fragment || nested instanceof DocumentFragment)) {
            // Inconsistent fragment state: keep the one-at-a-time semantics.
            const reference = index === null ? null : (this.#childNodes?.[index] ?? null);
            for (const nested of Array.from(moved)) {
                if (reference === null)
                    this.appendChild(nested);
                else
                    this.insertBefore(nested, reference);
            }
            return;
        }
        const document = this.documentForCreation();
        const nodes = moved.slice();
        moved.length = 0;
        const children = (this.#childNodes ??= []);
        const tail = index === null ? [] : children.splice(index);
        for (const node of nodes) {
            node.parentNode = this;
            node.setOwnerDocument(document);
            node.#index = children.length;
            children.push(node);
        }
        for (const node of tail) {
            node.#index = children.length;
            children.push(node);
        }
    }
    /** Connectedness to a document. */
    get isConnected() {
        let node = this;
        while (node?.parentNode)
            node = node.parentNode;
        return node?.nodeType === NodeType.DOCUMENT;
    }
    /** Node value for character-data nodes. */
    get nodeValue() {
        return null;
    }
    set nodeValue(_value) { }
    /** Text contained by this node. */
    get textContent() {
        const children = this.#childNodes;
        if (!children?.length)
            return "";
        const only = children[0];
        if (children.length === 1 && only instanceof Text)
            return only.data;
        return collectText(children);
    }
    set textContent(value) {
        this.replaceChildren();
        if (value)
            this.appendChild(this.documentForCreation().createTextNode(value));
    }
    /** Parent element, excluding document and fragments. */
    get parentElement() {
        return this.parentNode instanceof Element ? this.parentNode : null;
    }
    /** Append a node, moving it from its old parent. */
    appendChild(child) {
        const node = child;
        if (node === this || node.contains(this))
            throw new Error("The new child is an ancestor of this node");
        if (child instanceof DocumentFragment) {
            this.#adoptChildren(child, null);
            return child;
        }
        child.parentNode?.removeChild(child);
        child.parentNode = this;
        child.setOwnerDocument(this.documentForCreation());
        const children = (this.#childNodes ??= []);
        node.#index = children.length;
        children.push(child);
        return child;
    }
    /** Insert a node before a current child, or append for null. */
    insertBefore(child, reference) {
        if (reference === null)
            return this.appendChild(child);
        const index = this.#childIndex(reference);
        if (index < 0)
            throw new Error("The reference node is not a child of this node");
        if (child instanceof DocumentFragment) {
            this.#adoptChildren(child, index);
            return child;
        }
        child.parentNode?.removeChild(child);
        child.parentNode = this;
        child.setOwnerDocument(this.documentForCreation());
        const node = child;
        node.#index = index;
        this.childNodes.splice(index, 0, child);
        return child;
    }
    /** Replace a current child with another node. */
    replaceChild(child, previous) {
        const index = this.#childIndex(previous);
        if (index < 0)
            throw new Error("The node to replace is not a child of this node");
        this.removeChild(previous);
        this.insertBefore(child, this.#childNodes?.[index] ?? null);
        return previous;
    }
    /** Remove a current child. */
    removeChild(child) {
        const index = this.#childIndex(child);
        if (index < 0)
            throw new Error("The node to remove is not a child of this node");
        this.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
    }
    /** Replace all children with nodes or strings. */
    replaceChildren(...children) {
        const previous = this.#childNodes;
        if (previous)
            for (const child of previous)
                child.parentNode = null;
        this.#childNodes = undefined;
        this.append(...children);
    }
    /** Append nodes or strings. */
    append(...children) {
        for (const child of children) {
            this.appendChild(typeof child === "string" ? this.documentForCreation().createTextNode(child) : child);
        }
    }
    /** Prepend nodes or strings. */
    prepend(...children) {
        const reference = this.firstChild;
        for (const child of children) {
            this.insertBefore(typeof child === "string" ? this.documentForCreation().createTextNode(child) : child, reference);
        }
    }
    /** Remove this node from its parent. */
    remove() {
        this.parentNode?.removeChild(this);
    }
    /** Replace this node in its parent. */
    replaceWith(...nodes) {
        const parent = this.parentNode;
        if (!parent)
            return;
        for (const node of nodes) {
            parent.insertBefore(typeof node === "string" ? this.documentForCreation().createTextNode(node) : node, this);
        }
        parent.removeChild(this);
    }
    /** Whether this node contains another node. */
    contains(other) {
        for (let node = other; node; node = node.parentNode)
            if (node === this)
                return true;
        return false;
    }
    /** Clone this node, optionally including descendants. */
    cloneNode(deep = false) {
        const clone = new Node(this.nodeType, this.nodeName, this.ownerDocument);
        if (deep && this.#childNodes)
            for (const child of this.#childNodes)
                clone.appendChild(child.cloneNode(true));
        return clone;
    }
    /** Compare tree position sufficiently for document-order consumers. */
    compareDocumentPosition(other) {
        if (this === other)
            return 0;
        if (this.contains(other))
            return 20;
        if (other.contains(this))
            return 10;
        const root = this.ownerDocument ?? this;
        const nodes = [];
        const visit = (node) => {
            nodes.push(node);
            for (const child of node.#childNodes ?? [])
                visit(child);
        };
        visit(root);
        return nodes.indexOf(this) < nodes.indexOf(other) ? 4 : 2;
    }
    setOwnerDocument(document) {
        if (this.nodeType !== NodeType.DOCUMENT)
            this.ownerDocument = document;
        const children = this.#childNodes;
        if (children)
            for (const child of children)
                child.setOwnerDocument(document);
    }
    documentForCreation() {
        if (this instanceof Document)
            return this;
        if (!this.ownerDocument)
            throw new Error("This node has no owner document");
        return this.ownerDocument;
    }
}
/** Text node. */
export class Text extends Node {
    data;
    serializeRaw;
    constructor(data, ownerDocument = null, serializeRaw = false) {
        super(NodeType.TEXT, "#text", ownerDocument);
        this.data = data;
        this.serializeRaw = serializeRaw;
    }
    /** Number of UTF-16 code units. */
    get length() {
        return this.data.length;
    }
    get nodeValue() {
        return this.data;
    }
    set nodeValue(value) {
        this.data = value ?? "";
    }
    get textContent() {
        return this.data;
    }
    set textContent(value) {
        this.data = value ?? "";
    }
    /** Split this text node at an offset. */
    splitText(offset) {
        const tail = new Text(this.data.slice(offset), this.ownerDocument, this.serializeRaw);
        this.data = this.data.slice(0, offset);
        this.parentNode?.insertBefore(tail, this.nextSibling);
        return tail;
    }
    cloneNode() {
        return new Text(this.data, this.ownerDocument, this.serializeRaw);
    }
}
/** Comment node. */
export class Comment extends Text {
    constructor(data, ownerDocument = null) {
        super(data, ownerDocument);
        Object.defineProperty(this, "nodeType", { value: NodeType.COMMENT });
        Object.defineProperty(this, "nodeName", { value: "#comment" });
    }
    cloneNode() {
        return new Comment(this.data, this.ownerDocument);
    }
}
/** DOM attribute value object. */
export class Attr extends Node {
    name;
    value;
    namespaceURI;
    constructor(name, value, ownerDocument = null, namespaceURI = null) {
        super(NodeType.ATTRIBUTE, name, ownerDocument);
        this.name = name;
        this.value = value;
        this.namespaceURI = namespaceURI;
    }
    get nodeValue() {
        return this.value;
    }
    set nodeValue(value) {
        this.value = value ?? "";
    }
    get textContent() {
        return this.value;
    }
    set textContent(value) {
        this.value = value ?? "";
    }
    cloneNode() {
        return new Attr(this.name, this.value, this.ownerDocument, this.namespaceURI);
    }
}
/** Array-like attribute collection. */
export class NamedNodeMap extends Array {
    /** Find an attribute case-insensitively. */
    getNamedItem(name) {
        const normalized = name.toLowerCase();
        for (let index = 0; index < this.length; index++) {
            const attr = this[index];
            if (attr.name === normalized || attr.name.toLowerCase() === normalized)
                return attr;
        }
        return null;
    }
    /** Set an attribute object and return the prior one. */
    setNamedItem(attr) {
        const previous = this.getNamedItem(attr.name);
        if (previous)
            this.splice(this.indexOf(previous), 1, attr);
        else
            this.push(attr);
        return previous;
    }
    /** Remove and return a named attribute. */
    removeNamedItem(name) {
        const attr = this.getNamedItem(name);
        if (!attr)
            throw new Error(`Attribute not found: ${name}`);
        this.splice(this.indexOf(attr), 1);
        return attr;
    }
}
/** Token-list view over an element class attribute. */
export class DOMTokenList {
    #element;
    constructor(element) {
        this.#element = element;
    }
    #tokens() {
        return this.#element.className.trim() ? this.#element.className.trim().split(/\s+/) : [];
    }
    #write(tokens) {
        this.#element.className = [...new Set(tokens)].join(" ");
    }
    /** Token count. */
    get length() {
        return this.#tokens().length;
    }
    /** String representation. */
    get value() {
        return this.#element.className;
    }
    set value(value) {
        this.#element.className = value;
    }
    /** Add class tokens. */
    add(...tokens) {
        this.#write([...this.#tokens(), ...tokens]);
    }
    /** Remove class tokens. */
    remove(...tokens) {
        const removed = new Set(tokens);
        this.#write(this.#tokens().filter(token => !removed.has(token)));
    }
    /** Whether a class token exists. */
    contains(token) {
        return hasClassToken(this.#element.className, token);
    }
    /** Toggle a class token. */
    toggle(token, force) {
        const present = this.contains(token);
        const enabled = force ?? !present;
        if (enabled && !present)
            this.add(token);
        else if (!enabled && present)
            this.remove(token);
        return enabled;
    }
    /** Replace one class token with another. */
    replace(previous, next) {
        const tokens = this.#tokens();
        const index = tokens.indexOf(previous);
        if (index < 0)
            return false;
        tokens[index] = next;
        this.#write(tokens);
        return true;
    }
    /** Token at an index. */
    item(index) {
        return this.#tokens()[index] ?? null;
    }
    [Symbol.iterator]() {
        return this.#tokens()[Symbol.iterator]();
    }
    toString() {
        return this.value;
    }
}
/** Mutable inline style declaration. */
export class CSSStyleDeclaration {
    /** Allocated on the first non-empty declaration. */
    #values;
    /** Serialized declarations; `undefined` after a change until the next read. */
    #cssText = "";
    /** Serialized declarations. */
    get cssText() {
        this.#cssText ??= this.#values ? [...this.#values].map(([name, value]) => `${name}: ${value};`).join(" ") : "";
        return this.#cssText;
    }
    set cssText(value) {
        this.#values?.clear();
        this.#cssText = undefined;
        for (const declaration of value.split(";")) {
            const colon = declaration.indexOf(":");
            if (colon > 0)
                this.setProperty(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
        }
    }
    /** Read a CSS property. */
    getPropertyValue(name) {
        return this.#values?.get(name) ?? "";
    }
    /** Set a CSS property. */
    setProperty(name, value, _priority) {
        if (value === null || value === "") {
            if (this.#values?.delete(name))
                this.#cssText = undefined;
            return;
        }
        this.#values ??= new Map();
        this.#values.set(name, String(value));
        this.#cssText = undefined;
    }
    /** Remove and return a CSS property. */
    removeProperty(name) {
        const value = this.getPropertyValue(name);
        if (this.#values?.delete(name))
            this.#cssText = undefined;
        return value;
    }
}
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
/** An element's inline style when one has been created; bound to Element's private field. */
let inlineStyleOf;
/** DOM element with attributes, selectors, and HTML serialization. */
export class Element extends Node {
    localName;
    tagName;
    namespaceURI;
    qualifiedName;
    /** Attribute, class-list and style objects are created on first use. */
    #attributes;
    #classList;
    #style;
    static {
        inlineStyleOf = element => element.#style;
    }
    constructor(tagName, ownerDocument = null, namespaceURI = HTML_NAMESPACE) {
        const localName = tagName.toLowerCase();
        const qualified = namespaceURI === HTML_NAMESPACE ? localName.toUpperCase() : tagName;
        super(NodeType.ELEMENT, qualified, ownerDocument);
        this.localName = localName;
        this.tagName = qualified;
        this.qualifiedName = tagName;
        this.namespaceURI = namespaceURI;
    }
    /** Attribute collection. */
    get attributes() {
        this.#attributes ??= new NamedNodeMap();
        return this.#attributes;
    }
    /** Class token list over the `class` attribute. */
    get classList() {
        this.#classList ??= new DOMTokenList(this);
        return this.#classList;
    }
    /** Inline style declaration. */
    get style() {
        this.#style ??= new CSSStyleDeclaration();
        return this.#style;
    }
    /** Whether the element has any attribute objects (without allocating the collection). */
    hasAttributes() {
        return this.#attributes !== undefined && this.#attributes.length > 0;
    }
    /** Element children. */
    get children() {
        return childElements(this);
    }
    /** First element child. */
    get firstElementChild() {
        return firstElementIn(this);
    }
    /** Last element child. */
    get lastElementChild() {
        return lastElementIn(this);
    }
    /** Previous sibling that is an element. */
    get previousElementSibling() {
        const index = indexInParent(this);
        if (index < 0)
            return null;
        const siblings = this.parentNode.childNodes;
        for (let position = index - 1; position >= 0; position--) {
            const sibling = siblings[position];
            if (sibling instanceof Element)
                return sibling;
        }
        return null;
    }
    /** Next sibling that is an element. */
    get nextElementSibling() {
        const index = indexInParent(this);
        if (index < 0)
            return null;
        const siblings = this.parentNode.childNodes;
        for (let position = index + 1; position < siblings.length; position++) {
            const sibling = siblings[position];
            if (sibling instanceof Element)
                return sibling;
        }
        return null;
    }
    /** Attribute-backed element id. */
    get id() {
        return this.getAttribute("id") ?? "";
    }
    set id(value) {
        this.setAttribute("id", value);
    }
    /** Attribute-backed class string. */
    get className() {
        return this.getAttribute("class") ?? "";
    }
    set className(value) {
        this.setAttribute("class", value);
    }
    /** Data attributes exposed as camel-cased properties. */
    get dataset() {
        const element = this;
        return new Proxy({}, {
            get(_target, property) {
                if (typeof property !== "string")
                    return undefined;
                return (element.getAttribute(`data-${property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`) ??
                    undefined);
            },
            set(_target, property, value) {
                if (typeof property === "string") {
                    element.setAttribute(`data-${property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, String(value));
                }
                return true;
            },
            ownKeys() {
                return element.attributes
                    .filter(attr => attr.name.startsWith("data-"))
                    .map(attr => attr.name.slice(5).replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase()));
            },
            getOwnPropertyDescriptor() {
                return { configurable: true, enumerable: true };
            },
        });
    }
    /** Linkedom-compatible legacy text property (only specialized elements define a value). */
    get text() {
        return undefined;
    }
    /** HTML contained inside this element. */
    get innerHTML() {
        return serializeChildren(this);
    }
    set innerHTML(value) {
        this.replaceChildren();
        parseInto(value, this.documentForCreation(), this);
    }
    /** Serialized element and descendants. */
    get outerHTML() {
        return serializeNode(this);
    }
    set outerHTML(value) {
        const parent = this.parentNode;
        if (!parent)
            return;
        parent.insertBefore(parseFragment(value, this.documentForCreation()), this);
        parent.removeChild(this);
    }
    /** Read an attribute. */
    getAttribute(name) {
        const style = this.#style;
        if (style && name.toLowerCase() === "style") {
            const cssText = style.cssText;
            if (cssText)
                return cssText;
        }
        return this.#attributes?.getNamedItem(name)?.value ?? null;
    }
    /** Read an attribute object. */
    getAttributeNode(name) {
        return this.#attributes?.getNamedItem(name) ?? null;
    }
    /** Whether an attribute exists. */
    hasAttribute(name) {
        return ((this.#attributes?.getNamedItem(name) ?? null) !== null ||
            (this.#style !== undefined && name.toLowerCase() === "style" && Boolean(this.#style.cssText)));
    }
    /** Set an attribute. */
    setAttribute(name, value) {
        const normalized = name.toLowerCase();
        if (normalized === "style")
            this.style.cssText = String(value);
        const attributes = this.attributes;
        const existing = attributes.getNamedItem(normalized);
        if (existing)
            existing.value = String(value);
        else
            attributes.unshift(new Attr(name, String(value), this.ownerDocument));
    }
    /** Set a namespaced attribute. */
    setAttributeNS(_namespace, name, value) {
        this.setAttribute(name, value);
    }
    /** Remove an attribute. */
    removeAttribute(name) {
        const attributes = this.#attributes;
        const existing = attributes?.getNamedItem(name);
        if (attributes && existing)
            attributes.splice(attributes.indexOf(existing), 1);
        if (this.#style && name.toLowerCase() === "style")
            this.#style.cssText = "";
    }
    /** Find the first descendant matching a selector. */
    querySelector(selector) {
        return querySelectorFrom(this, selector);
    }
    /** Find all descendants matching a selector. */
    querySelectorAll(selector) {
        return querySelectorAllFrom(this, selector, false);
    }
    /** Whether this element matches a selector. */
    matches(selector) {
        return matchesSelector(this, selector);
    }
    /** Find the nearest matching ancestor including this element. */
    closest(selector) {
        return closestMatching(this, selector);
    }
    /** Descendant elements with a tag name. */
    getElementsByTagName(tagName) {
        return this.querySelectorAll(tagName === "*" ? "*" : tagName);
    }
    /** Descendant elements containing all requested class tokens. */
    getElementsByClassName(classNames) {
        const tokens = classNames.trim().split(/\s+/).filter(Boolean);
        return querySelectorAllFrom(this, "*", false).filter(element => {
            const className = element.className;
            return tokens.every(token => hasClassToken(className, token));
        });
    }
    /**
     * Return a zero-sized rectangle because this parser DOM has no layout.
     * Browser-side scripts only use this method's standard shape.
     */
    getBoundingClientRect() {
        return { x: 0, y: 0, bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 };
    }
    /** Focus this element in its owner document. */
    focus() {
        if (this.ownerDocument)
            this.ownerDocument.activeElement = this;
        this.dispatchEvent(new Event("focus"));
    }
    /** Clear focus from this element. */
    blur() {
        if (this.ownerDocument?.activeElement === this)
            this.ownerDocument.activeElement = this.ownerDocument.body;
        this.dispatchEvent(new Event("blur"));
    }
    /** Trigger a synthetic click event. */
    click() {
        this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    }
    cloneNode(deep = false) {
        const clone = this.ownerDocument?.createElementNS(this.namespaceURI, this.qualifiedName) ??
            new Element(this.qualifiedName, null, this.namespaceURI);
        const attributes = this.#attributes;
        if (attributes) {
            for (let index = attributes.length - 1; index >= 0; index--) {
                const attr = attributes[index];
                clone.setAttribute(attr.name, attr.value);
            }
        }
        if (deep && this.hasChildNodes())
            for (const child of this.childNodes)
                clone.appendChild(child.cloneNode(true));
        return clone;
    }
}
/** HTML element implementation. */
export class HTMLElement extends Element {
    value = "";
    checked = false;
    selected = false;
    disabled = false;
    multiple = false;
    defaultValue = "";
    defaultChecked = false;
    /** Reflected title attribute. */
    get title() {
        return this.getAttribute("title") ?? "";
    }
    set title(value) {
        this.setAttribute("title", value);
    }
    /** Reflected href attribute. */
    get href() {
        const value = this.getAttribute("href") ?? "";
        try {
            return new URL(value, this.ownerDocument?.URL || "about:blank").href;
        }
        catch {
            return value;
        }
    }
    set href(value) {
        this.setAttribute("href", value);
    }
    /** Reflected input type. */
    get type() {
        return this.getAttribute("type") ?? "";
    }
    set type(value) {
        this.setAttribute("type", value);
    }
    /** Reflected name. */
    get name() {
        return this.getAttribute("name") ?? "";
    }
    set name(value) {
        this.setAttribute("name", value);
    }
}
/** HTML meta element with a reflected content attribute. */
export class HTMLMetaElement extends HTMLElement {
    /** Reflected metadata content. */
    get content() {
        return this.getAttribute("content") ?? "";
    }
    set content(value) {
        this.setAttribute("content", value);
    }
}
/** SVG element marker used by React feature checks. */
export class SVGElement extends Element {
}
/** Iframe element marker used by React selection restoration. */
export class HTMLIFrameElement extends HTMLElement {
}
/** Document fragment. */
export class DocumentFragment extends Node {
    constructor(ownerDocument = null) {
        super(NodeType.DOCUMENT_FRAGMENT, "#document-fragment", ownerDocument);
    }
    /** Element children. */
    get children() {
        return childElements(this);
    }
    /** First element child. */
    get firstElementChild() {
        return firstElementIn(this);
    }
    /** Last element child. */
    get lastElementChild() {
        return lastElementIn(this);
    }
    /** First matching descendant. */
    querySelector(selector) {
        return querySelectorFrom(this, selector);
    }
    /** All matching descendants. */
    querySelectorAll(selector) {
        return querySelectorAllFrom(this, selector, false);
    }
    cloneNode(deep = false) {
        const clone = new DocumentFragment(this.ownerDocument);
        if (deep)
            for (const child of this.childNodes)
                clone.appendChild(child.cloneNode(true));
        return clone;
    }
}
/** HTML template whose parsed descendants live in a document fragment. */
export class HTMLTemplateElement extends HTMLElement {
    content;
    constructor(tagName, ownerDocument = null, namespaceURI = HTML_NAMESPACE) {
        super(tagName, ownerDocument, namespaceURI);
        this.content = new DocumentFragment(ownerDocument);
    }
    get innerHTML() {
        return serializeChildren(this.content);
    }
    set innerHTML(value) {
        this.content.replaceChildren();
        parseInto(value, this.documentForCreation(), this.content);
    }
    get textContent() {
        return this.content.textContent ?? "";
    }
    set textContent(value) {
        this.content.textContent = value;
    }
    appendChild(child) {
        return this.content.appendChild(child);
    }
    insertBefore(child, reference) {
        return this.content.insertBefore(child, reference);
    }
    replaceChild(child, previous) {
        return this.content.replaceChild(child, previous);
    }
    removeChild(child) {
        return this.content.removeChild(child);
    }
    cloneNode(deep = false) {
        const clone = new HTMLTemplateElement(this.qualifiedName, this.ownerDocument, this.namespaceURI);
        for (let index = this.attributes.length - 1; index >= 0; index--) {
            const attr = this.attributes[index];
            clone.setAttribute(attr.name, attr.value);
        }
        if (deep)
            for (const child of this.content.childNodes)
                clone.content.appendChild(child.cloneNode(true));
        return clone;
    }
}
/** Minimal HTML document. */
export class Document extends Node {
    defaultView = null;
    URL = "about:blank";
    activeElement = null;
    constructor() {
        super(NodeType.DOCUMENT, "#document", null);
        this.ownerDocument = null;
    }
    /** Root element of the document. */
    get documentElement() {
        return firstElementIn(this);
    }
    /** Element children. */
    get children() {
        return childElements(this);
    }
    /** HTML body, or a detached empty body when absent like linkedom. */
    get body() {
        const body = querySelectorFrom(this, "body");
        return body instanceof HTMLElement ? body : this.createElement("body");
    }
    /** HTML head, or a detached empty head when absent. */
    get head() {
        const head = querySelectorFrom(this, "head");
        return head instanceof HTMLElement ? head : this.createElement("head");
    }
    /** Document title text. */
    get title() {
        return querySelectorFrom(this, "title")?.textContent ?? "";
    }
    set title(value) {
        let title = querySelectorFrom(this, "title");
        if (!title) {
            title = this.createElement("title");
            this.head.appendChild(title);
        }
        title.textContent = value;
    }
    get textContent() {
        return null;
    }
    set textContent(_value) { }
    /** Create an HTML element. */
    createElement(tagName, _options) {
        switch (tagName.toLowerCase()) {
            case "iframe":
                return new HTMLIFrameElement(tagName, this, HTML_NAMESPACE);
            case "meta":
                return new HTMLMetaElement(tagName, this, HTML_NAMESPACE);
            case "template":
                return new HTMLTemplateElement(tagName, this, HTML_NAMESPACE);
            default:
                return new HTMLElement(tagName, this, HTML_NAMESPACE);
        }
    }
    /** Create a namespaced element. */
    createElementNS(namespace, tagName) {
        if (namespace === SVG_NAMESPACE)
            return new SVGElement(tagName, this, namespace);
        if (namespace === null || namespace === HTML_NAMESPACE)
            return this.createElement(tagName);
        return new HTMLElement(tagName, this, namespace);
    }
    /** Create a text node. */
    createTextNode(data) {
        return new Text(data, this);
    }
    /** Create a comment. */
    createComment(data) {
        return new Comment(data, this);
    }
    /** Create an attribute. */
    createAttribute(name) {
        return new Attr(name.toLowerCase(), "", this);
    }
    /** Create a document fragment. */
    createDocumentFragment() {
        return new DocumentFragment(this);
    }
    /** Find the first element by id. */
    getElementById(id) {
        // Ids free of selector syntax compare directly; the rest keep the escaped-selector path's exact behaviour.
        const element = SELECTOR_SAFE_ID.test(id)
            ? findElementById(this, id)
            : querySelectorFrom(this, `#${cssEscapeIdentifier(id)}`);
        return element instanceof HTMLElement ? element : null;
    }
    /** Find the first matching descendant. */
    querySelector(selector) {
        return querySelectorFrom(this, selector);
    }
    /** Find all matching descendants. */
    querySelectorAll(selector) {
        return querySelectorAllFrom(this, selector, true);
    }
    /** Descendant elements with a tag name. */
    getElementsByTagName(tagName) {
        return this.querySelectorAll(tagName === "*" ? "*" : tagName);
    }
    /** Descendant elements containing all class tokens. */
    getElementsByClassName(classNames) {
        const tokens = classNames.trim().split(/\s+/).filter(Boolean);
        return this.querySelectorAll("*").filter(element => {
            const className = element.className;
            return tokens.every(token => hasClassToken(className, token));
        });
    }
    /** Adopt a node into this document. */
    adoptNode(node) {
        node.parentNode?.removeChild(node);
        node.setOwnerDocument(this);
        return node;
    }
    /** Import a cloned node into this document. */
    importNode(node, deep = false) {
        const clone = node.cloneNode(deep);
        clone.setOwnerDocument(this);
        return clone;
    }
    /** Legacy event factory used by libraries. */
    createEvent(_kind) {
        return new Event("");
    }
    cloneNode(deep = false) {
        const clone = new Document();
        if (deep)
            for (const child of this.childNodes)
                clone.appendChild(child.cloneNode(true));
        return clone;
    }
}
/** Window shape returned by parseHTML. */
export class DOMWindow extends EventTarget {
    document;
    Node = Node;
    Element = Element;
    HTMLElement = HTMLElement;
    HTMLIFrameElement = HTMLIFrameElement;
    SVGElement = SVGElement;
    Text = Text;
    Comment = Comment;
    Document = Document;
    DocumentFragment = DocumentFragment;
    Event = Event;
    CustomEvent = CustomEvent;
    navigator = { userAgent: "pi-utils-dom", platform: "" };
    location = { href: "about:blank" };
    window;
    self;
    top;
    parent;
    constructor(document) {
        super();
        this.document = document;
        this.window = this;
        this.self = this;
        this.top = this;
        this.parent = this;
        document.defaultView = this;
    }
    /** Browser-compatible computed style placeholder. */
    getComputedStyle(element) {
        return element.style;
    }
    /** Schedule an animation callback. */
    requestAnimationFrame(callback) {
        return globalThis.setTimeout(() => callback(Date.now()), 16);
    }
    /** Cancel an animation callback. */
    cancelAnimationFrame(handle) {
        globalThis.clearTimeout(handle);
    }
    /** Empty selection object. */
    getSelection() {
        return { rangeCount: 0, removeAllRanges() { } };
    }
}
const VOID_ELEMENTS = {
    area: true,
    base: true,
    br: true,
    col: true,
    embed: true,
    hr: true,
    img: true,
    input: true,
    link: true,
    meta: true,
    param: true,
    source: true,
    track: true,
    wbr: true,
};
const BOOLEAN_ATTRIBUTES = {
    allowfullscreen: true,
    async: true,
    autofocus: true,
    autoplay: true,
    checked: true,
    controls: true,
    default: true,
    defer: true,
    disabled: true,
    formnovalidate: true,
    hidden: true,
    inert: true,
    ismap: true,
    itemscope: true,
    loop: true,
    multiple: true,
    muted: true,
    nomodule: true,
    novalidate: true,
    open: true,
    playsinline: true,
    readonly: true,
    required: true,
    reversed: true,
    selected: true,
};
const TEXT_ESCAPE_PATTERN = /[&\u00a0<>]/;
/** Ids whose escaped `#id` selector parses as one plain id compound (no combinators, lists, quotes or groups). */
const SELECTOR_SAFE_ID = /^[^\s,>+~"'[\]()\\]+$/;
function escapeText(value) {
    if (!TEXT_ESCAPE_PATTERN.test(value))
        return value;
    return value
        .replace(/&/g, "&amp;")
        .replace(/\u00a0/g, "&#160;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
function escapeAttribute(value) {
    return value.includes('"') ? value.replace(/"/g, "&quot;") : value;
}
/** Serialize a node's children; `raw` emits text data unescaped (script/style content). */
function serializeChildren(parent, raw = false) {
    if (!parent.hasChildNodes())
        return "";
    let html = "";
    for (const child of parent.childNodes)
        html += raw && child instanceof Text ? child.data : serializeNode(child);
    return html;
}
/** Serialize a DOM node as HTML. */
export function serializeNode(node) {
    if (node instanceof Comment)
        return `<!--${node.data}-->`;
    if (node instanceof Text)
        return node.serializeRaw ? node.data : escapeText(node.data);
    if (node instanceof Document || node instanceof DocumentFragment)
        return serializeChildren(node);
    if (!(node instanceof Element))
        return "";
    let opening = `<${node.qualifiedName}`;
    const hasAttributes = node.hasAttributes();
    if (hasAttributes) {
        for (const attr of node.attributes) {
            opening +=
                attr.value === "" && BOOLEAN_ATTRIBUTES[attr.name.toLowerCase()]
                    ? ` ${attr.name}`
                    : ` ${attr.name}="${escapeAttribute(attr.value)}"`;
        }
    }
    const cssText = inlineStyleOf(node)?.cssText;
    if (cssText && !(hasAttributes && node.attributes.getNamedItem("style"))) {
        opening += ` style="${escapeAttribute(cssText)}"`;
    }
    opening += ">";
    if (VOID_ELEMENTS[node.localName])
        return opening;
    const raw = node.localName === "script" || node.localName === "style";
    const content = serializeChildren(node instanceof HTMLTemplateElement ? node.content : node, raw);
    return `${opening}${content}</${node.qualifiedName}>`;
}
function childElements(parent) {
    return parent.hasChildNodes() ? parent.childNodes.filter((child) => child instanceof Element) : [];
}
function firstElementIn(parent) {
    if (!parent.hasChildNodes())
        return null;
    for (const child of parent.childNodes)
        if (child instanceof Element)
            return child;
    return null;
}
function lastElementIn(parent) {
    if (!parent.hasChildNodes())
        return null;
    const children = parent.childNodes;
    for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index];
        if (child instanceof Element)
            return child;
    }
    return null;
}
/** First descendant element in document order whose `id` equals `id`. */
function findElementById(parent, id) {
    if (!parent.hasChildNodes())
        return null;
    for (const child of parent.childNodes) {
        if (child instanceof Element && child.id === id)
            return child;
        const found = findElementById(child, id);
        if (found)
            return found;
    }
    return null;
}
/**
 * Concatenate descendant text iteratively, mirroring each node type's `textContent`: character data and
 * attributes contribute their value, documents nothing, templates their content fragment.
 */
function collectText(children) {
    let text = "";
    const pending = [];
    for (let index = children.length - 1; index >= 0; index--)
        pending.push(children[index]);
    while (pending.length > 0) {
        const node = pending.pop();
        if (node instanceof Text) {
            text += node.data;
            continue;
        }
        if (node instanceof Attr) {
            text += node.value;
            continue;
        }
        if (node instanceof Document)
            continue;
        const owner = node instanceof HTMLTemplateElement ? node.content : node;
        if (!owner.hasChildNodes())
            continue;
        const nested = owner.childNodes;
        for (let index = nested.length - 1; index >= 0; index--)
            pending.push(nested[index]);
    }
    return text;
}
function cssEscapeIdentifier(value) {
    return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}
