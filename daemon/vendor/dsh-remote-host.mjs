// Built from liguobao/ds-harness-remote (MIT) at ea1c0925f8be825a5f5afac32ad2d0b2c699f7f7:
// the Host side of DSH Remote device pairing and its end-to-end encrypted relay connection
// (packages/plugin host-pairing, server-connection, connection-controller, identity-store,
// server-api, server-credentials, logging; packages/protocol, crypto, webrtc), bundled with
// zod, @noble/*, @lukeburns/clatterjs, @deepseek-ai/cosmokit and @deepseek-ai/schemastery
// (all MIT). Not edited here; see LICENSE.dsh-remote and README.md in this directory.
// packages/plugin/src/host-pairing.ts
import { createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes as randomBytes7, createCipheriv, createDecipheriv } from "node:crypto";
import { join as join2 } from "node:path";
import { rm as rm2 } from "node:fs/promises";

// node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === undefined;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys)
    return { ...source };
  const result = {};
  for (const key of keys)
    if (forced || source[key] !== undefined)
      result[key] = source[key];
  return result;
}
var write = Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set) {
  if (typeof value === "function")
    throw new TypeError("volatile config cannot contain functions");
  if (value === null || typeof value !== "object")
    return value;
  if (ancestors.has(value))
    throw new TypeError("volatile config cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => snapshot(item, ancestors)));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new TypeError("volatile config objects must be plain objects or arrays");
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
  } finally {
    ancestors.delete(value);
  }
}
function createVolatile(value) {
  let current = snapshot(value);
  return Object.freeze({
    get: () => current,
    [write]: (value) => {
      current = value;
    }
  });
}
function isVolatile(value) {
  return typeof value === "object" && value !== null && write in value;
}
function is(type, value) {
  if (arguments.length === 1)
    return (value) => is(type, value);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary) {
  Binary.is = isArrayBufferLike;
  Binary.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source))
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else
      return source;
  }
  Binary.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined")
      return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0;i < bytes.byteLength; i++)
      binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined")
      return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined")
      return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined")
      return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0;i < hex.length; i += 2)
      buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map) {
  if (!source || typeof source !== "object")
    return source;
  if (is("Date", source))
    return new Date(source.valueOf());
  if (is("RegExp", source))
    return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source))
    return source.slice(0);
  if (ArrayBuffer.isView(source))
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached)
    return cached;
  if (Array.isArray(source)) {
    const result = [];
    refs.set(source, result);
    source.forEach((value, index) => {
      result[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor)
      descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  const ancestors = /* @__PURE__ */ new Set;
  function compare(a, b) {
    if (a === b)
      return true;
    if (isVolatile(a) || isVolatile(b))
      return isVolatile(a) && isVolatile(b);
    if (!strict && isNullable(a) && isNullable(b))
      return true;
    if (typeof a !== typeof b || typeof a !== "object" || !a || !b)
      return false;
    if (ancestors.has(a))
      return false;
    function check(test, then) {
      return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : undefined;
    }
    ancestors.add(a);
    try {
      return check(Array.isArray, (a, b) => {
        if (a.length !== b.length)
          return false;
        for (let index = 0;index < a.length; index++)
          if (!compare(a[index], b[index]))
            return false;
        return true;
      }) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("URL"), (a, b) => a.href === b.href) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
        if (a.byteLength !== b.byteLength)
          return false;
        const viewA = new Uint8Array(a);
        const viewB = new Uint8Array(b);
        for (let i = 0;i < viewA.length; i++)
          if (viewA[i] !== viewB[i])
            return false;
        return true;
      }) ?? ((!strict || [a, b].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
        ...a,
        ...b
      }).every((key) => compare(a[key], b[key])));
    } finally {
      ancestors.delete(a);
    }
  }
  return compare(a, b);
}
var Time;
(function(Time) {
  Time.millisecond = 1;
  Time.second = 1000;
  Time.minute = Time.second * 60;
  Time.hour = Time.minute * 60;
  Time.day = Time.hour * 24;
  Time.week = Time.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date = /* @__PURE__ */ new Date, offset) {
    if (typeof date === "number")
      date = new Date(date);
    if (offset === undefined)
      offset = timezoneOffset;
    return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
  }
  Time.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date = new Date(value * Time.day);
    if (offset === undefined)
      offset = timezoneOffset;
    return new Date(+date + offset * Time.minute);
  }
  Time.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture)
      return 0;
    return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
  }
  Time.parseTime = parseTime;
  function parseDate(date) {
    const parsed = parseTime(date);
    if (parsed)
      date = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date))
      date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date))
      date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
    return date ? new Date(date) : /* @__PURE__ */ new Date;
  }
  Time.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time.day - Time.hour / 2)
      return Math.round(ms / Time.day) + "d";
    else if (abs >= Time.hour - Time.minute / 2)
      return Math.round(ms / Time.hour) + "h";
    else if (abs >= Time.minute - Time.second / 2)
      return Math.round(ms / Time.minute) + "m";
    else if (abs >= Time.second)
      return Math.round(ms / Time.second) + "s";
    return ms + "ms";
  }
  Time.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time.toDigits = toDigits;
  function template(template, time = /* @__PURE__ */ new Date) {
    return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time.template = template;
})(Time || (Time = {}));

// node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = Symbol.for("schemastery");
var kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = undefined;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || [])
      if (typeof segment === "string")
        prefix += "." + segment;
      else if (typeof segment === "number")
        prefix += "[" + segment + "]";
      else if (typeof segment === "symbol")
        prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith("."))
      prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options = {}) {
    return Schema.resolve(data, schema, options)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options) => new Schema(options));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options = refs[key];
      options.sKey = getRef(options.sKey);
      options.inner = getRef(options.inner);
      options.list = options.list && options.list.map(getRef);
      options.dict = options.dict && mapValues(options.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string")
    try {
      schema.callback = new Function("return " + schema.callback)();
    } catch {}
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error))
          return { issues: [{
            message: error.message,
            path: error.options.path
          }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = undefined;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc)
      result[locale] = value.$description || value.$desc;
    else if (typeof value === "string")
      result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length)
    schema.meta.description = desc;
  if (schema.dict)
    schema.dict = mapValues(schema.dict, (inner, key) => {
      return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
    });
  if (schema.list)
    schema.list = schema.list.map((inner, index) => {
      return inner.i18n(mapValues(messages, (data = {}) => {
        if (Array.isArray(getInner(data)))
          return getInner(data)[index];
        if (Array.isArray(data))
          return data[index];
        return extractKeys(data);
      }));
    });
  if (schema.inner)
    schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
      if (getInner(data))
        return getInner(data);
      return extractKeys(data);
    }));
  if (schema.sKey)
    schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
])
  Object.assign(Schema.prototype, { [key](value = true) {
    const schema = Schema(this);
    schema.meta = {
      ...schema.meta,
      [key]: value
    };
    return schema;
  } });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (isVolatile(value))
    value = value.get();
  if (deepEqual(value, this.meta.default, this.type === "dict"))
    return null;
  if (isNullable(value))
    return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item))
        result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict"))
      return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value) : value;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list)
      Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union")
    for (const schema of this.list)
      try {
        Schema.resolve(value, schema, {});
        return schema.simplify(value);
      } catch {}
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
])
  Object.assign(Schema.prototype, { [key](value) {
    const schema = Schema(this);
    schema.meta = {
      ...schema.meta,
      [key]: value
    };
    return schema;
  } });
Schema.prototype.volatile = function volatile() {
  if (this.meta.volatile)
    throw new TypeError("volatile schema is already wrapped");
  return this.extra("volatile", true);
};
var resolvers = {};
var checkedVolatile = Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map) {
  const states = seen.get(schema) ?? /* @__PURE__ */ new Set;
  if (states.has(blocked))
    return;
  states.add(blocked);
  seen.set(schema, states);
  if (schema.meta?.volatile && blocked)
    throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
  const nested = blocked || !!schema.meta?.volatile;
  if (schema.dict)
    for (const [key, child] of Object.entries(schema.dict))
      validateVolatileSchema(child, [...path, key], nested, seen);
  if (schema.sKey)
    validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
  if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema]))
    validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
  if (schema.list)
    for (let index = 0;index < schema.list.length; index++)
      validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve) {
  resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema)
    return [data];
  if (!options[checkedVolatile]) {
    validateVolatileSchema(schema, options.path);
    options = {
      ...options,
      [checkedVolatile]: true
    };
  }
  if (schema.meta?.volatile) {
    const inner = Schema(schema);
    inner.meta = {
      ...schema.meta,
      volatile: false
    };
    const [value, adapted] = Schema.resolve(data, inner, options, strict);
    try {
      return [createVolatile(value), adapted];
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error), options);
    }
  }
  if (options.ignore?.(data, schema))
    return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required)
      throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback))
      return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback)
    throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose)
      throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source))
    return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source))
    return Schema.const(source).required();
  else if (source[kSchema])
    return source;
  else if (typeof source === "function")
    switch (source) {
      case String:
        return Schema.string().required();
      case Number:
        return Schema.number().required();
      case Boolean:
        return Schema.boolean().required();
      case Function:
        return Schema.function().required();
      default:
        return Schema.is(source).required();
    }
  else
    throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date = new Date(value);
    if (isNaN(+date))
      throw new ValidationError(`invalid date "${value}"`, options);
    return date;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value))
        return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
    validateVolatileSchema(schema.inner, options.path, true);
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value))
    return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max)
    throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin)
    throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string")
    throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data))
      throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e"))
    return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1)
    return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits)
    return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString()))
    return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number")
    throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step))
    throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean")
    return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits)
      if (data & bits[key])
        keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string")
        throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits)
        value |= bits[key];
    }
  } else
    throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default)
    return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function")
    return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor)
      return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data))
      throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor)
        return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== undefined)
      data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix)
      throw e;
    delete data[key];
    return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data))
    throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data))
    throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict)
        continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey)
      delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data))
    throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict)
    return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result)
      continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data))
    throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data)
      result[key] = value;
  }
  if (!strict)
    merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
  const messages = [];
  for (const inner of list)
    try {
      return Schema.resolve(data, inner, options, strict);
    } catch (error) {
      messages.push(error);
    }
  throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
  if (!list.length)
    return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value))
      continue;
    if (isNullable(result))
      result = value;
    else if (typeof result !== typeof value)
      throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object")
      merge(result ??= {}, value);
    else if (result !== value)
      throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data))
    merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve)
    return [callback(result)];
  else
    return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name, keys, format) {
  formatters[name] = format;
  Object.assign(Schema, { [name](...args) {
    const schema = new Schema({ type: name });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key in args[index]) {
            if (typeof args[index][key] !== "number")
              continue;
            schema.bits[key] = args[index][key];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function")
            constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name === "object" || name === "dict")
      schema.meta.default = {};
    else if (name === "array" || name === "tuple")
      schema.meta.default = [];
    else if (name === "bitset")
      schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function")
    return constructor.name;
  else
    return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0)
    return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}

class Cached {
  constructor(getter) {
    this._getter = getter;
    this._value = undefined;
  }
  get value() {
    const getter = this._getter;
    if (getter !== undefined) {
      this._value = getter();
      this._getter = undefined;
    }
    return this._value;
  }
}
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys, wrap) {
  const raw = sourceShape(source);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject2(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject2(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone2(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== undefined && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick2(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema, maskedKeys(schema, mask));
  return clone2(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  const raw = sourceShape(schema);
  const keys = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema, mask));
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
  return clone2(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject2(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== undefined) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone2(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject2(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone2(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge2(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone2(a, def);
}
function partial(Class, schema, mask, name = "partial") {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema, mask)) : undefined;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({ type: "optional", innerType: value })));
  return clone2(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required(Class, schema, mask) {
  const selected = mask ? new Set(maskedKeys(schema, mask)) : undefined;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({ type: "nonoptional", innerType: value }));
  return clone2(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function sizeCaps(defChecks) {
  const caps = [];
  for (const ch of defChecks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    const max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a;
  for (let i = start;i < issues.length; i++) {
    (_a = issues[i]).schema ?? (_a.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config) {
  var _a;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a = iss).schema ?? (_a.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : undefined;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0;i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? undefined : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = undefined;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: undefined };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
var CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}

// node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: undefined, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition;
      }
      try {
        return new Definition;
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition;
}
function $constructor(name, initializer, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = new Set;
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && new WeakSet;
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = undefined;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer(inst, def);
    if (initialized) {
      const own = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto = _.prototype;
    for (const k in proto) {
      if (!Object.prototype.hasOwnProperty.call(proto, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = undefined;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: undefined, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = undefined;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, undefined, {
  Parent: Error
});
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error, path = []) => {
    for (const issue of error.issues) {
      if (issue.code === "invalid_union" && issue.errors.length) {
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      } else if (issue.code === "invalid_key") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else if (issue.code === "invalid_element") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else {
        const fullpath = [...path, ...issue.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node = curr[el];
            if (terminal) {
              node._errors.push(mapper(issue));
            }
            curr = node;
            i++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
var _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError;
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
function failure(Err, issues, ctx) {
  let error;
  return {
    success: false,
    get error() {
      if (!error) {
        error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = undefined;
        ctx = undefined;
      }
      return error;
    },
    set error(e) {
      error = e;
      issues = undefined;
      ctx = undefined;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
var COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
var validate = (schema, value, _ctx) => {
  const validator = schema._zod.bag.validator;
  if (validator !== undefined) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === undefined)
      return false;
  }
  return validateFallback(schema, value, _ctx);
};
function validateFallback(schema, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length === 0;
}
var validateAsync = async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
};
var _encode = (_Err) => {
  const parse = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decode = (_Err) => {
  const parse = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    return parse(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _encodeAsync = (_Err) => {
  const parseAsync = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decodeAsync = (_Err) => {
  const parseAsync = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
// node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function anchor(source) {
  return new RegExp(`^${source}$`);
}
var date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts = ["Z"];
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var anyString = /^[\s\S]{0,}$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== undefined;
};
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units > def.maximum ? codePointLength(input) : units;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = [], closed = {}) {
    this.content = [];
    this.indent = 0;
    this.args = args;
    this.closed = closed;
  }
  indented(fn) {
    this.indent += 1;
    try {
      fn(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const content = this?.content ?? [``];
    const factory = new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join(`
`)}
};`);
    return factory(...Object.values(this.closed));
  }
}

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 7
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary) => {
            return handleCanaryResult(canary, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync2(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {}
      return validateAsync2(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var URL_BAD_FORMAT = 1;
var URL_UNPARSEABLE = 2;
function canParseURL(input) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input);
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
var asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
  hostname.lastIndex = 0;
  return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url = validateURL(trimmed, def);
      if (url === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === true) {
        payload.value = stripTabAndNewline(trimmed);
        return;
      }
      if (def.hostname && !urlHostnameOk(url, def.hostname)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      if (def.protocol && !urlProtocolOk(url, def.protocol)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid protocol",
          pattern: def.protocol.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  if (def.length !== undefined && (!Number.isInteger(def.length) || def.length < 1))
    throw new Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === undefined ? nanoid : nanoidOfLength(def.length));
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
});
var ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function capSize(inst, size) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  const cap = Math.min(...caps.map((c) => c[0]));
  const parse = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, ch] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && ch._zod.def.when(payload)) {
          const start = payload.issues.length;
          ch._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse(payload, ctx);
  };
}
var arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result) => handleArrayResult(result, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
  capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== undefined && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === undefined) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: undefined,
        path: [key]
      });
    }
    return;
  }
  if (result.value === undefined) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = undefined;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, new Set);
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== undefined)
          propValues[key].add(undefined);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const memo = globalConfig.memoizer;
  const generateFastpass = (shape) => {
    const normalized = _normalized.value;
    const syms = normalized.symbolKeys;
    const doc = new Doc(["payload", "ctx"], { shape, inst, memo, syms });
    const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.allKeys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
    for (const key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      const id = ids[key];
      const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
      const isPresent = `${k} in input`;
      const schema = shape[key];
      const optin = schema?._zod?.optin;
      const isOptionalIn = optin !== undefined;
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(k)};`);
      if (isOptionalIn && isOptionalOut) {
        const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
        doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
        if (optin === "defaulted") {
          doc.write(`newResult[${k}] = ${id}.value;`);
        } else {
          doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
        }
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    return doc.compile();
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== undefined) ? "optional" : undefined);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => {
      return handleUnionResults(results, payload, inst, ctx);
    });
  };
});
function discriminatorMap(def) {
  const map = new Map;
  for (const option of def.options) {
    const values = option._zod.propValues?.[def.discriminator];
    if (!values || values.size === 0)
      throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
    for (const value of values) {
      if (map.has(value)) {
        if (value !== undefined)
          throw new Error(`Duplicate discriminator value "${String(value)}"`);
        map.set(value, null);
      } else {
        map.set(value, option);
      }
    }
  }
  return map;
}
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazyInternal(inst, "propValues", (zod) => {
    const propValues = {};
    let undefinedCount = 0;
    for (const option of zod.def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
      if (pv[zod.def.discriminator]?.has(undefined))
        undefinedCount++;
      for (const [k, v] of Object.entries(pv)) {
        if (!Object.prototype.hasOwnProperty.call(propValues, k)) {
          assignProp(propValues, k, new Set);
        }
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    if (!zod.def.unionFallback && undefinedCount > 1)
      propValues[zod.def.discriminator]?.delete(undefined);
    return propValues;
  });
  def.options.forEach((option, i) => {
    const propShape = rawShape(option._zod.def);
    if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) {
      throw new Error(`Invalid discriminated union option at index "${i}"`);
    }
  });
  const disc = cached(() => discriminatorMap(def));
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const value = input?.[def.discriminator];
    const opt = disc.value.get(value);
    if (opt && (value !== undefined || ctx.direction !== "backward")) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()).filter((value) => disc.value.get(value) !== null),
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left, right]) => {
        return handleIntersectionResults(payload, left, right);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject2(a) && isPlainObject2(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = new Map;
  let unrecIssue;
  const keyIssues = new Map;
  const collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys = [k];
    } else {
      return false;
    }
    for (const k of keys) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k of bothKeys) {
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodTuple = /* @__PURE__ */ $constructor("$ZodTuple", (inst, def) => {
  $ZodType.init(inst, def);
  const items = def.items;
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        input,
        inst,
        expected: "tuple",
        code: "invalid_type"
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, [], ctx) : [];
    const proms = [];
    const optinStart = getTupleOptStart(items, "optin");
    const optoutStart = getTupleOptStart(items, "optout");
    if (!def.rest) {
      if (input.length < optinStart) {
        payload.issues.push({
          code: "too_small",
          minimum: optinStart,
          inclusive: true,
          input,
          inst,
          origin: "array"
        });
        return payload;
      }
      if (input.length > items.length) {
        payload.issues.push({
          code: "too_big",
          maximum: items.length,
          inclusive: true,
          input,
          inst,
          origin: "array"
        });
      }
    }
    const itemResults = new Array(items.length);
    const abortEarly = def.rest ? ctx?.abortEarly : undefined;
    let itemAborted = false;
    for (let i = 0;i < items.length; i++) {
      const r = items[i]._zod.run({ value: input[i], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((rr) => {
          itemResults[i] = rr;
        }));
      } else {
        itemResults[i] = r;
        if (abortEarly && !itemAborted && r.issues.length)
          itemAborted = aborted(r);
      }
    }
    if (def.rest && !itemAborted) {
      let i = items.length - 1;
      const rest = input.slice(items.length);
      let seen = payload.issues.length;
      for (const el of rest) {
        if (abortEarly && payload.issues.length !== seen) {
          if (aborted(payload, seen))
            break;
          seen = payload.issues.length;
        }
        i++;
        const result = def.rest._zod.run({ value: el, issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((r) => handleTupleResult(r, payload, i)));
        } else {
          handleTupleResult(result, payload, i);
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => handleTupleResults(itemResults, payload, items, input, optoutStart));
    }
    return handleTupleResults(itemResults, payload, items, input, optoutStart);
  };
});
function getTupleOptStart(items, key) {
  for (let i = items.length - 1;i >= 0; i--) {
    const omittable = key === "optin" ? items[i]._zod.optin !== undefined : items[i]._zod.optout === "optional";
    if (!omittable)
      return i + 1;
  }
  return 0;
}
function handleTupleResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
function handleTupleResults(itemResults, final, items, input, optoutStart) {
  for (let i = 0;i < items.length; i++) {
    const r = itemResults[i];
    const isPresent = i < input.length;
    if (!isPresent && i >= optoutStart && items[i]._zod.optin === "optional") {
      final.value.length = i;
      break;
    }
    if (r.issues.length) {
      if (!isPresent && i >= optoutStart) {
        final.value.length = i;
        break;
      }
      final.issues.push(...prefixIssues(i, r.issues));
    }
    final.value[i] = r.value;
  }
  for (let i = final.value.length - 1;i >= input.length; i--) {
    if (items[i]._zod.optout === "optional" && final.value[i] === undefined) {
      final.value.length = i;
    } else {
      break;
    }
  }
  return final;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject2(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values && !def.partial) {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      const recordKeys = new Set;
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          if (key === "__proto__")
            continue;
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          if (outKey === "__proto__")
            continue;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result) => {
              if (result.issues.length) {
                payload.issues.push(...prefixIssues(key, result.issues));
              }
              payload.value[outKey] = result.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          if (def.mode === "loose") {
            if (key === "__proto__")
              continue;
            payload.value[key] = input[key];
          } else {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          }
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    } else {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      let unrecognized;
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else if (values) {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const outKey = keyResult.value;
        if (outKey === "__proto__")
          continue;
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result) => {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[outKey] = result.value;
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const values = new Set(def.values);
  inst._zod.values = values;
  defineLazyInternal(inst, "pattern", (zod) => {
    const vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output) => {
        payload.value = output;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? undefined : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? new Set([...values, undefined]) : undefined;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === undefined) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result) => handleOptionalResult(payload, result));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? new Set([...zod.def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleDefaultResult(result, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => {
    const v = zod.def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleNonOptionalResult(result, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleCatchResult(payload, result, def, ctx));
    }
    return handleCatchResult(payload, result, def, ctx);
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left) => handlePipeResult(left, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
  $ZodPipe.init(inst, def);
});
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r) => handleRefineResult(r, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// node_modules/zod/v4/core/memoizer.js
class $ZodCyclicError extends Error {
  constructor() {
    super(`Cannot parse a reference cycle that closes through a transform`);
    this.name = "ZodCyclicError";
  }
}
var STATE = "~memo";
var NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
var recursive = /* @__PURE__ */ new WeakMap;
var NONE = 0;
var ASSUMED = 1;
var PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  const cached = recursive.get(inst);
  if (cached !== undefined)
    return cached ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack, resolve);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge(raw ? shape(raw, true) : ASSUMED);
      check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType);
      check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left);
      check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in);
      check(def.out);
      break;
    case "function":
      check(def.input);
      check(def.output);
      break;
    case "lazy": {
      const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : undefined);
      merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
      break;
    }
    case "template_literal":
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (const el of value)
            check(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = new WeakMap;
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
var handoff;
var open = [];
var memo = {
  alloc(_inst, payload, empty) {
    const bucket = handoff;
    if (!bucket)
      return empty;
    handoff = undefined;
    const entry = { value: empty, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty;
  },
  guard(inst) {
    var _a;
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError;
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === undefined) {
          const walked = isRecursive(inst, new Set, false);
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state) {
          state = { buckets: new WeakMap, backEdges: undefined };
          ctx[STATE] = state;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state.backEdges ?? (state.backEdges = new WeakSet);
            state.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = undefined;
        const entry = open.length > depth ? open.pop() : undefined;
        if (result instanceof Promise) {
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== undefined && isRef(value) && backEdges.has(value);
}
// node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  function getTypeName(type, input) {
    if (type === "number" && typeof input === "number" && !Number.isFinite(input)) {
      return String(input);
    }
    return TypeDictionary[type] ?? type;
  }
  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        const expected = getTypeName(issue.expected);
        const receivedType = parsedType(issue.input);
        const received = getTypeName(receivedType, issue.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
      case "too_big": {
        const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
        const sizing = getSizing(issue.origin);
        if (sizing)
          return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
        const sizing = getSizing(issue.origin);
        if (sizing) {
          return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue.origin}`;
      case "invalid_union":
        if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
          const opts = issue.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        if (issue.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}
// node_modules/zod/v4/core/registries.js
var _a2;
class $ZodRegistry {
  constructor() {
    this._map = new WeakMap;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new WeakMap;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
function _string(Class, params) {
  return new Class(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class, params) {
  return new Class(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _slugify() {
  return _overwrite((input) => slugify(input));
}
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
function _superRefine(fn, params) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: new Map,
    sharedDefsExtractedFor: undefined,
    sharedEmitDoneFor: undefined,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? undefined
  };
}
function handleUnrepresentable(schema, ctx, json, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === undefined || result === "throw")
    throw new Error(message);
  Object.assign(json, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: undefined, path: _params.path };
  ctx.seen.set(schema, result);
  ctx.sharedDefsExtractedFor = undefined;
  ctx.sharedEmitDoneFor = undefined;
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    assignProps(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = new Map;
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id) => id);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema = seen.schema;
    for (const key in schema) {
      delete schema[key];
    }
    schema.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error("Cycle detected: " + `#/${seen.cycle?.join("/")}/<root>` + '\n\nSet the `cycles` parameter to `"ref"` to resolve cyclical schemas with defs.');
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== undefined)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
var FOLDABLE_KEYS = new Set(["type", "properties", "required", "additionalProperties"]);
var UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === undefined || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members) {
  const objects = [];
  for (const member of members) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required = new Set;
  for (const object of objects) {
    for (const key in object.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === undefined)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object.required ?? [])
      required.add(key);
  }
  const folded = { type: "object", properties };
  if (required.size)
    folded.required = [...required];
  if (objects.every((object) => object.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object of objects) {
      const constraint = undeclaredConstraint(object);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  const allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
    if (Object.keys(union).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union);
    const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf;
  assignProps(json, folded);
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema = seen.def ?? seen.schema;
    const _cached = { ...schema };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema.allOf = schema.allOf ?? [];
        schema.allOf.push(refSchema);
      } else {
        assignProps(schema, refSchema);
      }
      assignProps(schema, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = new Map;
      for (const seen of ctx.seen.values()) {
        for (const json of [seen.schema, seen.def]) {
          const allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json of carriers.get(allOf) ?? [])
          foldIntersection(json);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {}
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== undefined && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) {} else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: new Set };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
// node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
  if (agg[key] === undefined || value > agg[key])
    agg[key] = value;
};
var narrowMax = (agg, key, value) => {
  if (agg[key] === undefined || value < agg[key])
    agg[key] = value;
};
var narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
var addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
var addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = new Set);
  agg.patterns.add(pattern);
};
var intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
var setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
var minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
var maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
var formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
var contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== undefined)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== undefined)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== undefined)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== undefined)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== undefined)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== undefined) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
};
var exactPatterns = new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
var exactPattern = (p) => exactPatterns.get(p) ?? p;
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time" || laxFormat) {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = new Set;
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== undefined)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  if (def.values.length === 0) {
    json.not = {};
    return;
  }
  const vals = [];
  for (const val of def.values) {
    if (val === undefined) {
      if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof val === "bigint") {
      if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
        return;
      vals.push(Number(val));
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {} else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json.type = "object";
  json.properties = {};
  for (const key in shape) {
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === undefined : field._zod.optout === undefined) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
  ctx.intersections.push(allOf);
};
var tupleProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "array";
  const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
  const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
  const prefixItems = def.items.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, prefixPath, i]
  }));
  const rest = def.rest ? processSchema(def.rest, ctx, {
    ...params,
    path: [...params.path, restPath, ...ctx.target === "openapi-3.0" ? [def.items.length] : []]
  }) : null;
  let minItems = def.items.length;
  while (minItems > 0) {
    const item = def.items[minItems - 1];
    const optional = ctx.io === "input" ? inputOptin(item) !== undefined : item._zod.optout === "optional";
    if (!optional)
      break;
    minItems--;
  }
  const maxItems = def.items.length;
  const isClosed = !def.rest;
  if (ctx.target === "draft-2020-12") {
    json.prefixItems = prefixItems;
    if (isClosed) {
      json.items = false;
    } else if (rest) {
      json.items = rest;
    }
    if (minItems > 0)
      json.minItems = minItems;
    if (isClosed)
      json.maxItems = maxItems;
  } else if (ctx.target === "openapi-3.0") {
    json.items = {
      anyOf: prefixItems
    };
    if (rest) {
      json.items.anyOf.push(rest);
    }
    if (minItems > 0)
      json.minItems = minItems;
    if (isClosed)
      json.maxItems = maxItems;
  } else {
    json.items = prefixItems;
    if (isClosed) {
      json.additionalItems = false;
    } else if (rest) {
      json.additionalItems = rest;
    }
    if (minItems > 0)
      json.minItems = minItems;
    if (isClosed)
      json.maxItems = maxItems;
  }
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
};
function stringifyKeyNames(bySchema, json, visited) {
  if (json.$ref) {
    if (visited.has(json))
      return json;
    visited.add(json);
    const def = bySchema.get(json)?.def;
    if (!def)
      return json;
    const inlined = stringifyKeyNames(bySchema, def, visited);
    return inlined === def ? json : inlined;
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches = json[keyword];
    if (!Array.isArray(branches))
      continue;
    const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
    if (mapped.some((branch, i) => branch !== branches[i]))
      json = { ...json, [keyword]: mapped };
  }
  const types = Array.isArray(json.type) ? json.type : [json.type];
  const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
  const values = json.enum ?? (json.const !== undefined ? [json.const] : undefined);
  if (!numericType && !values?.some((v) => typeof v === "number"))
    return json;
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json;
  if (rest.enum)
    rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
  else if (typeof rest.const === "number")
    rest.const = String(rest.const);
  if (!numericType)
    return rest;
  rest.type = "string";
  if (!values)
    rest.pattern = (types.includes("number") ? number : integer).source;
  return rest;
}
var pendingRecords = new WeakMap;
function rewriteKeyNames(ctx) {
  const bySchema = new Map;
  for (const entry of ctx.seen.values()) {
    if (entry.def && !bySchema.has(entry.schema))
      bySchema.set(entry.schema, entry);
  }
  const rewrites = new Map;
  for (const record of pendingRecords.get(ctx) ?? []) {
    const seen = ctx.seen.get(record);
    const names = (seen?.def ?? seen?.schema)?.propertyNames;
    if (!names || names === true || rewrites.has(names))
      continue;
    const rewritten = stringifyKeyNames(bySchema, names, new Set);
    if (rewritten !== names)
      rewrites.set(names, rewritten);
  }
  if (!rewrites.size)
    return;
  for (const entry of ctx.seen.values()) {
    for (const carrier of [entry.schema, entry.def]) {
      const rewritten = carrier && rewrites.get(carrier.propertyNames);
      if (rewritten)
        carrier.propertyNames = rewritten;
    }
  }
}
var recordProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const patterns = aggregateChecks(keyType).patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = processSchema(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
      let pending = pendingRecords.get(ctx);
      if (!pending) {
        pending = [];
        pendingRecords.set(ctx, pending);
        ctx.deferred.push(() => rewriteKeyNames(ctx));
      }
      pending.push(schema);
    }
    json.additionalProperties = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== undefined;
  if (keyValues && !def.partial && !omittableOnInput) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues.map(String);
    }
  }
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var UNREPRESENTABLE_DEFAULT = Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(undefined);
  } catch {
    handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
// node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue) => {
    self.issues.push(issue);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues) => {
    self.issues.push(...issues);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, undefined, {
  Parent: Error
});

// node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  _ensureDefaultLocale();
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  return inst;
}, {
  check(...chks) {
    const def = this.def;
    return this.clone(mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: true });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone2(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta) {
    reg.add(this, meta);
    return this;
  },
  refine(check, params) {
    return this.check(refine(check, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn) {
    return this.check(_overwrite(fn));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe(this, transform(tx));
  },
  default(d) {
    return _default(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    const cl = this.clone();
    globalRegistry.add(cl, { description });
    return cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    const cl = this.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  },
  isOptional() {
    return this.safeParse(undefined).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  },
  get "~standard"() {
    return hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  },
  parse: function _parse(data, params) {
    return parse2(this, data, params, { callee: _parse });
  },
  parseAsync: async function _parseAsync(data, params) {
    return await parseAsync(this, data, params, { callee: _parseAsync });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    own(this, "spa", value);
  },
  validate(data, params) {
    return validate(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync(this, data, params);
  },
  encode: function _encode(data, params) {
    return encode(this, data, params, { callee: _encode });
  },
  decode: function _decode(data, params) {
    return decode(this, data, params, { callee: _decode });
  },
  encodeAsync: async function _encodeAsync(data, params) {
    return await encodeAsync(this, data, params, { callee: _encodeAsync });
  },
  decodeAsync: async function _decodeAsync(data, params) {
    return await decodeAsync(this, data, params, { callee: _decodeAsync });
  },
  safeEncode(data, params) {
    return safeEncode(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  get description() {
    return globalRegistry.get(this)?.description;
  },
  get _def() {
    return this._zod.def;
  }
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
}, /* @__PURE__ */ derived({
  format: (inst) => aggregateChecks(inst).format ?? null,
  minLength: (inst) => aggregateChecks(inst).minimum ?? null,
  maxLength: (inst) => aggregateChecks(inst).maximum ?? null
}, {
  regex(...args) {
    return this.check(_regex(...args));
  },
  includes(...args) {
    return this.check(_includes(...args));
  },
  startsWith(...args) {
    return this.check(_startsWith(...args));
  },
  endsWith(...args) {
    return this.check(_endsWith(...args));
  },
  min(...args) {
    return this.check(_minLength(...args));
  },
  max(...args) {
    return this.check(_maxLength(...args));
  },
  length(...args) {
    return this.check(_length(...args));
  },
  nonempty(...args) {
    return this.check(_minLength(1, ...args));
  },
  lowercase(params) {
    return this.check(_lowercase(params));
  },
  uppercase(params) {
    return this.check(_uppercase(params));
  },
  trim() {
    return this.check(_trim());
  },
  normalize(...args) {
    return this.check(_normalize(...args));
  },
  toLowerCase() {
    return this.check(_toLowerCase());
  },
  toUpperCase() {
    return this.check(_toUpperCase());
  },
  slugify() {
    return this.check(_slugify());
  }
}));
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(_email(ZodEmail, params));
  },
  url(params) {
    return this.check(_url(ZodURL, params));
  },
  jwt(params) {
    return this.check(_jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(_emoji2(ZodEmoji, params));
  },
  guid(params) {
    return this.check(_guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(_uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(_uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(_uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(_uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(_nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(_cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(_cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(_ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(_base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(_base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(_xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(_ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(_ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(_ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(_cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(_cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(_e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(_isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(_isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(_isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(_isoDuration(ZodISODuration, params));
  }
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
  inst.isFinite = true;
}, /* @__PURE__ */ derived({
  minValue: (inst) => {
    const { minimum, exclusiveMinimum } = aggregateChecks(inst);
    return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
  },
  maxValue: (inst) => {
    const { maximum, exclusiveMaximum } = aggregateChecks(inst);
    return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
  },
  isInt: (inst) => {
    const { isInt, multipleOf } = aggregateChecks(inst);
    return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
  },
  format: (inst) => aggregateChecks(inst).format ?? null
}, {
  gt(value, params) {
    return this.check(_gt(value, params));
  },
  gte(value, params) {
    return this.check(_gte(value, params));
  },
  min(value, params) {
    return this.check(_gte(value, params));
  },
  lt(value, params) {
    return this.check(_lt(value, params));
  },
  lte(value, params) {
    return this.check(_lte(value, params));
  },
  max(value, params) {
    return this.check(_lte(value, params));
  },
  int(params) {
    return this.check(int(params));
  },
  safe(params) {
    return this.check(int(params));
  },
  positive(params) {
    return this.check(_gt(0, params));
  },
  nonnegative(params) {
    return this.check(_gte(0, params));
  },
  negative(params) {
    return this.check(_lt(0, params));
  },
  nonpositive(params) {
    return this.check(_lte(0, params));
  },
  multipleOf(value, params) {
    return this.check(_multipleOf(value, params));
  },
  step(value, params) {
    return this.check(_multipleOf(value, params));
  },
  finite() {
    return this;
  }
}));
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
}, {
  min(n, params) {
    return this.check(_minLength(n, params));
  },
  nonempty(params) {
    return this.check(_minLength(1, params));
  },
  max(n, params) {
    return this.check(_maxLength(n, params));
  },
  length(n, params) {
    return this.check(_length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(mergeDefs(this._zod.def, { catchall: undefined }));
  },
  extend(incoming) {
    return extend(this, incoming);
  },
  safeExtend(incoming) {
    return safeExtend(this, incoming);
  },
  merge(other) {
    return merge2(this, other);
  },
  pick(mask) {
    return pick2(this, mask);
  },
  omit(mask) {
    return omit(this, mask);
  },
  partial(...args) {
    return partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return required(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodTuple = /* @__PURE__ */ $constructor("ZodTuple", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTuple.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => tupleProcessor(inst, ctx, json, params);
}, {
  rest(rest) {
    return this.clone({
      ...this._zod.def,
      rest
    });
  },
  partial() {
    const def = this._zod.def;
    if (def.checks?.length)
      throw new Error(".partial() cannot be used on tuple schemas containing refinements");
    return this.clone({
      ...def,
      items: def.items.map((item) => new ZodOptional({ type: "optional", innerType: item }))
    });
  }
});
function tuple(items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new ZodTuple({
    type: "tuple",
    items,
    rest,
    ...normalizeParams(params)
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = [...inst._zod.values];
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output) => {
        payload.value = output;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodPreprocess.init(inst, def);
});
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}
// packages/plugin/src/config.ts
var entryConfigSchema = Schema.object({
  enabled: Schema.boolean(),
  role: Schema.union(["host", "client", "both"]),
  serverUrl: Schema.string(),
  httpServerAllowlist: Schema.array(Schema.string()),
  deviceName: Schema.string(),
  terminal: Schema.object({ enabled: Schema.boolean() }),
  remoteTools: Schema.object({ enabled: Schema.boolean() }),
  sidebar: Schema.object({ entry: Schema.union(["standard", "compact"]) }),
  hostControl: Schema.object({ enabled: Schema.boolean() }),
  loopback: Schema.object({ ports: Schema.array(Schema.number()) }),
  forceRelay: Schema.boolean(),
  rotatePinnedPeerKey: Schema.boolean(),
  logLevel: Schema.union(["debug", "info", "warn", "error"]),
  reconnect: Schema.union([
    Schema.boolean(),
    Schema.object({
      initialDelayMs: Schema.number(),
      maxDelayMs: Schema.number(),
      jitter: Schema.number()
    })
  ]),
  codex: Schema.object({
    enabled: Schema.boolean(),
    binary: Schema.string()
  }),
  cursor: Schema.object({
    enabled: Schema.boolean(),
    binary: Schema.string()
  }),
  acp: Schema.object({ enabled: Schema.boolean(), backends: Schema.array(Schema.object({ id: Schema.string(), enabled: Schema.boolean(), command: Schema.string(), args: Schema.array(Schema.string()), cwd: Schema.string() })) })
});
function withVolatileSchema(schema) {
  const volatile = schema.volatile;
  return typeof volatile === "function" ? volatile.call(schema) : schema;
}
var Config = withVolatileSchema(entryConfigSchema);
var reconnectSchema = union([
  boolean2(),
  object({
    initialDelayMs: number2().int().min(100).max(60000).optional(),
    maxDelayMs: number2().int().min(1000).max(300000).optional(),
    jitter: number2().min(0).max(1).optional()
  }).strict()
]);
var configSchema = object({
  enabled: boolean2().optional(),
  role: _enum(["host", "client", "both"]).optional(),
  serverUrl: string2().url().optional(),
  httpServerAllowlist: array(string2().trim().min(1).max(128)).max(64).optional(),
  deviceName: string2().trim().min(1).max(80).optional(),
  terminal: object({ enabled: boolean2().optional() }).strict().optional(),
  remoteTools: object({ enabled: boolean2().optional() }).strict().optional(),
  sidebar: object({ entry: _enum(["standard", "compact"]).optional() }).strict().optional(),
  hostControl: object({ enabled: boolean2().optional() }).strict().optional(),
  loopback: object({ ports: array(number2().int().min(1024).max(65535)).max(16).optional() }).strict().optional(),
  forceRelay: boolean2().optional(),
  rotatePinnedPeerKey: boolean2().optional(),
  logLevel: _enum(["debug", "info", "warn", "error"]).optional(),
  reconnect: reconnectSchema.optional(),
  codex: object({
    enabled: boolean2().optional(),
    binary: string2().trim().min(1).max(4096).optional()
  }).strict().optional(),
  cursor: object({
    enabled: boolean2().optional(),
    binary: string2().trim().min(1).max(4096).optional()
  }).strict().optional(),
  acp: object({ enabled: boolean2().optional(), backends: array(object({ id: string2().trim().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/i), enabled: boolean2().optional(), command: string2().trim().min(1).max(4096).optional(), args: array(string2().max(4096)).max(32).optional(), cwd: string2().max(4096).optional() }).strict()).max(12).optional(), backend: string2().trim().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/i).optional(), command: string2().trim().min(1).max(4096).optional(), args: array(string2().max(4096)).max(32).optional(), cwd: string2().max(4096).optional() }).strict().optional()
}).strict();
var LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
function isPrivateIpv6(hostname) {
  const host = (hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname).toLowerCase();
  if (!host.includes(":") || !/^[0-9a-f:]+$/.test(host))
    return false;
  if (host === "::1")
    return true;
  return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}
function isPrivateNetworkHostname(hostname) {
  if (LOCAL_HOSTS.has(hostname))
    return true;
  if (isPrivateIpv6(hostname))
    return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (match === null)
    return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value > 255))
    return false;
  const [a, b] = octets;
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127;
}
function normalizeServerUrl(value, httpServerAllowlist = []) {
  const url = new URL(value);
  const privateHttp = url.protocol === "http:" && (isPrivateNetworkHostname(url.hostname) || matchesHttpServerAllowlist(url.hostname, httpServerAllowlist));
  if (url.protocol !== "https:" && !privateHttp) {
    throw new TypeError("serverUrl must use HTTPS (HTTP is allowed only for localhost or private-network addresses)");
  }
  if (url.username !== "" || url.password !== "") {
    throw new TypeError("serverUrl must not contain credentials");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new TypeError("serverUrl must not contain query parameters or fragments");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new TypeError("serverUrl must be an origin without a path");
  }
  return url.origin;
}
function matchesHttpServerAllowlist(hostname, allowlist) {
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const address = parseIpAddress(host);
  const normalizedHost = host.toLowerCase();
  return allowlist.some((entry) => {
    const slash = entry.indexOf("/");
    if (slash === -1) {
      const exact = parseIpAddress(entry);
      return exact === undefined ? entry.toLowerCase() === normalizedHost : address !== undefined && exact.version === address.version && exact.value === address.value;
    }
    if (address === undefined)
      return false;
    const network = parseIpAddress(entry.slice(0, slash));
    const prefix = Number(entry.slice(slash + 1));
    if (network === undefined || network.version !== address.version)
      return false;
    const bits = network.version === 4 ? 32n : 128n;
    const mask = prefix === 0 ? 0n : (1n << BigInt(prefix)) - 1n << bits - BigInt(prefix);
    return (network.value & mask) === (address.value & mask);
  });
}
function parseIpAddress(value) {
  const normalized = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return parseIpv4(normalized) ?? parseIpv6(normalized);
}
function parseIpv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part)))
    return;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255))
    return;
  return { version: 4, value: octets.reduce((result, octet) => result << 8n | BigInt(octet), 0n) };
}
function parseIpv6(value) {
  const normalized = value.toLowerCase();
  if (!normalized.includes(":") || normalized.includes("%"))
    return;
  const sections = normalized.split("::");
  if (sections.length > 2)
    return;
  const expand = (section) => {
    if (section === "")
      return [];
    const parts = section.split(":");
    const result = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const ipv4 = parseIpv4(part);
        if (ipv4 === undefined)
          return;
        result.push(Number(ipv4.value >> 16n & 0xffffn), Number(ipv4.value & 0xffffn));
      } else if (/^[0-9a-f]{1,4}$/.test(part)) {
        result.push(Number.parseInt(part, 16));
      } else
        return;
    }
    return result;
  };
  const left = expand(sections[0]);
  const right = expand(sections.length === 2 ? sections[1] : "");
  if (left === undefined || right === undefined)
    return;
  const hextets = sections.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : left;
  if (hextets.length !== 8)
    return;
  return { version: 6, value: hextets.reduce((result, hextet) => result << 16n | BigInt(hextet), 0n) };
}

// packages/plugin/src/server-credentials.ts
import { chmod, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";

// packages/plugin/src/ids.ts
import { randomBytes } from "node:crypto";
function uuidV7(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 281474976710655) {
    throw new RangeError("UUIDv7 timestamp must be a non-negative 48-bit integer");
  }
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let index = 5;index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 112 | bytes[6] & 15;
  bytes[8] = 128 | bytes[8] & 63;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// packages/plugin/src/server-credentials.ts
var credentialSchema = object({
  schemaVersion: literal(1),
  serverUrl: string2().url(),
  deviceId: string2().min(1),
  authorizationMethod: _enum(["account", "host_registration_code", "owned_device", "device_pairing"]),
  accountKind: _enum(["standard", "device_only"]).optional(),
  pairingRestricted: boolean2().optional(),
  inboundOnly: boolean2().optional(),
  account: string2().min(1).max(254).optional(),
  accessToken: string2().min(16),
  accessTokenExpiresAt: number2().int().positive(),
  refreshToken: string2().min(16),
  refreshTokenExpiresAt: number2().int().positive()
}).strict();

class ServerCredentialStore {
  path;
  constructor(directory) {
    this.path = join(directory, "server-credentials.json");
  }
  async withRefreshLock(operation) {
    const gate = defaultMigrationGate(dirname(this.path));
    const run = () => withQueueLock(`${this.path}.refresh-lock`, operation);
    return gate === undefined ? run() : withQueueLock(gate, run);
  }
  async pairingHostOnly() {
    const policy = await readPrivateJson(join(dirname(this.path), "pairing-host-only.json"));
    if (policy === undefined)
      return false;
    object({ hostOnly: literal(true) }).strict().parse(policy);
    return true;
  }
  async restrictPairingHostOnly() {
    await atomicWritePrivate(join(dirname(this.path), "pairing-host-only.json"), '{"hostOnly":true}');
  }
  async load(serverUrl, deviceId) {
    if (!await exists(this.path))
      return;
    await assertPrivateMode(this.path);
    let parsed;
    try {
      parsed = credentialSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      throw new ServerCredentialsInvalidError(`server credentials are invalid: ${safeMessage(error)}`);
    }
    return parsed.serverUrl === serverUrl && parsed.deviceId === deviceId ? parsed : undefined;
  }
  async save(credentials) {
    const record = credentialSchema.parse({ schemaVersion: 1, ...credentials });
    await atomicWritePrivate(this.path, `${JSON.stringify(record, null, 2)}
`);
    return record;
  }
  async clear() {
    await rm(this.path, { force: true });
  }
}
function defaultMigrationGate(directory) {
  const parts = directory.split(sep);
  let rootIndex = -1;
  for (let index = parts.length - 1;index >= 0; index--) {
    if ((parts[index] === "remote" || parts[index] === "ds-harness-remote") && (index === parts.length - 1 || parts[index + 1] === "servers")) {
      rootIndex = index;
      break;
    }
  }
  if (rootIndex < 1)
    return;
  const suffix = parts.slice(rootIndex + 1);
  if (suffix.length !== 0 && (suffix.length !== 3 || suffix[0] !== "servers" || !/^[a-f0-9]{24}$/.test(suffix[1]) || !["host", "client"].includes(suffix[2])))
    return;
  return join(parts.slice(0, rootIndex).join(sep) || sep, ".ds-harness-remote-migration", "credential-refresh-gate");
}
function withDefaultCredentialMigrationGate(home, operation) {
  return withQueueLock(join(home, ".ds-harness-remote-migration", "credential-refresh-gate"), operation);
}
async function assertRefreshQueueIdle(directory) {
  const lock = join(directory, "server-credentials.json.refresh-lock");
  const marker = await readQueueMarker(lock);
  if (marker === undefined) {
    if ((await readdir(directory)).some((name) => name.startsWith(`${basename(lock)}.holder-`) && !name.endsWith(".tmp"))) {
      throw new ServerCredentialsBusyError;
    }
    return;
  }
  if (marker !== SERVER_CREDENTIALS_QUEUE_MARKER)
    throw new ServerCredentialsBusyError;
  if ((await participants(lock)).length > 0)
    throw new ServerCredentialsBusyError;
}
async function withQueueLock(lock, operation) {
  await mkdir(dirname(lock), { recursive: true, mode: 448 });
  const deadline = Date.now() + 15000;
  await ensureQueueMarker(lock, deadline);
  const id = `${process.pid}-${uuidV7()}`;
  const holder = `${lock}.holder-${id}`;
  await publishExclusive(holder, `${id} choosing
`);
  try {
    const ticket = 1 + (await participants(lock)).reduce((max, entry) => Math.max(max, entry.ticket ?? 0), 0);
    if (!Number.isSafeInteger(ticket))
      throw new ServerCredentialsBusyError;
    await atomicWritePrivate(holder, `${id} ${ticket}
`);
    for (;; ) {
      const entries = await participants(lock);
      const preceding = entries.some((entry) => entry.id !== id && (entry.ticket === undefined || entry.ticket < ticket || entry.ticket === ticket && entry.id < id));
      if (!preceding)
        break;
      if (Date.now() >= deadline)
        throw new ServerCredentialsBusyError;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return await operation();
  } finally {
    await rm(holder, { force: true });
  }
}

class ServerCredentialsInvalidError extends Error {
  code = "SERVER_CREDENTIALS_INVALID";
}

class ServerCredentialsBusyError extends Error {
  code = "SERVER_CREDENTIALS_BUSY";
  constructor() {
    super("Credential refresh is busy. Stop other instances. Remove a legacy refresh lock only after every instance stops.");
  }
}

class ServerCredentialsLockUnsupportedError extends Error {
  code = "SERVER_CREDENTIALS_LOCK_UNSUPPORTED";
  constructor() {
    super("Credential lock cannot create a hard link in DSH_HOME. Use a writable local ext4 or XFS file system.");
  }
}
var SERVER_CREDENTIALS_QUEUE_MARKER = `DSH_REFRESH_LOCK_V2
`;
async function ensureQueueMarker(lock, deadline) {
  for (;; ) {
    try {
      await publishExclusive(lock, SERVER_CREDENTIALS_QUEUE_MARKER);
      return;
    } catch (error) {
      if (!await isLockContention(error, lock))
        throw error;
      if (await readQueueMarker(lock) === SERVER_CREDENTIALS_QUEUE_MARKER)
        return;
      if (Date.now() >= deadline)
        throw new ServerCredentialsBusyError;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
async function participants(lock) {
  const prefix = `${basename(lock)}.holder-`;
  const entries = await readdir(dirname(lock));
  const result = [];
  for (const name of entries) {
    if (!name.startsWith(prefix))
      continue;
    if (name.endsWith(".tmp"))
      continue;
    const id = name.slice(prefix.length);
    if (!/^\d+-[0-9a-f-]{36}$/.test(id))
      throw new ServerCredentialsBusyError;
    const path = join(dirname(lock), name);
    const record = await readLockRecord(path);
    if (record === undefined)
      continue;
    const match = new RegExp(`^${id} (choosing|[1-9]\\d*)\\n$`).exec(record);
    if (match === null)
      throw new ServerCredentialsBusyError;
    const pid = Number(id.slice(0, id.indexOf("-")));
    if (await ownerExited(pid)) {
      await rm(path, { force: true });
      continue;
    }
    const ticket = match[1] === "choosing" ? undefined : Number(match[1]);
    if (ticket !== undefined && !Number.isSafeInteger(ticket))
      throw new ServerCredentialsBusyError;
    result.push({ id, ...ticket === undefined ? {} : { ticket } });
  }
  return result;
}
async function publishExclusive(path, record) {
  const temporary = `${path}.${process.pid}.${uuidV7()}.tmp`;
  await writeFile(temporary, record, { mode: 384, flag: "wx" });
  try {
    try {
      await link(temporary, path);
    } catch (error) {
      if (error instanceof Error && "code" in error && ["EXDEV", "EOPNOTSUPP", "ENOTSUP", "ENOSYS", "EPERM", "EACCES"].includes(String(error.code))) {
        throw new ServerCredentialsLockUnsupportedError;
      }
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
async function isLockContention(error, path) {
  if (!(error instanceof Error) || !("code" in error))
    return false;
  if (error.code === "EEXIST")
    return true;
  if (process.platform !== "win32" || error.code !== "EPERM")
    return false;
  return exists(path);
}
async function readLockRecord(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
}
async function readQueueMarker(lock) {
  try {
    return await readLockRecord(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EISDIR")
      return;
    throw error;
  }
}
async function ownerExited(pid) {
  if (pid < 1 || pid > 2147483647 || pid === process.pid)
    return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}
async function atomicWritePrivate(path, contents) {
  await mkdir(dirname(path), { recursive: true, mode: 448 });
  const temporary = `${path}.${process.pid}.${uuidV7()}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", mode: 384, flag: "wx" });
  await chmod(temporary, 384);
  await rename(temporary, path);
  await chmod(path, 384);
}
async function assertPrivateMode(path) {
  if (process.platform === "win32")
    return;
  const mode = (await stat(path)).mode & 511;
  if ((mode & 63) !== 0)
    throw new ServerCredentialsInvalidError("server credentials permissions must be 0600");
}
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
function safeMessage(error) {
  return error instanceof Error ? error.message : "invalid credential data";
}
async function readPrivateJson(path) {
  if (!await exists(path))
    return;
  await assertPrivateMode(path);
  return JSON.parse(await readFile(path, "utf8"));
}

// packages/plugin/src/server-api.ts
import { platform } from "node:os";

// packages/crypto/node_modules/@noble/ciphers/esm/cryptoNode.js
import * as nc from "node:crypto";
var crypto = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && ("randomBytes" in nc) ? nc : undefined;

// packages/crypto/node_modules/@noble/ciphers/esm/webcrypto.js
function randomBytes2(bytesLength = 32) {
  if (crypto && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto && typeof crypto.randomBytes === "function") {
    return Uint8Array.from(crypto.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// packages/crypto/node_modules/@noble/hashes/esm/cryptoNode.js
import * as nc2 from "node:crypto";
var crypto2 = nc2 && typeof nc2 === "object" && "webcrypto" in nc2 ? nc2.webcrypto : nc2 && typeof nc2 === "object" && ("randomBytes" in nc2) ? nc2 : undefined;

// packages/crypto/node_modules/@noble/hashes/esm/utils.js
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function clean(...arrays) {
  for (let i = 0;i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0;i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  if (hasHexBuiltin)
    return Uint8Array.fromHex(hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0;ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === undefined || n2 === undefined) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0;i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0;i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
class Hash {
}
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function randomBytes3(bytesLength = 32) {
  if (crypto2 && typeof crypto2.getRandomValues === "function") {
    return crypto2.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto2 && typeof crypto2.randomBytes === "function") {
    return Uint8Array.from(crypto2.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// packages/crypto/node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE);
  const _32n = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE ? 4 : 0;
  const l = isLE ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE);
  view.setUint32(byteOffset + l, wl, isLE);
}
class HashMD extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE) {
    super();
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0;pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (;blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos;i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0;i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor);
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
}
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// packages/crypto/node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0;i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var shrSH = (h, _l, s) => h >>> s;
var shrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// packages/crypto/node_modules/@noble/hashes/esm/sha2.js
var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);

class SHA512 extends HashMD {
  constructor(outputLen = 64) {
    super(128, outputLen, 16, false);
    this.Ah = SHA512_IV[0] | 0;
    this.Al = SHA512_IV[1] | 0;
    this.Bh = SHA512_IV[2] | 0;
    this.Bl = SHA512_IV[3] | 0;
    this.Ch = SHA512_IV[4] | 0;
    this.Cl = SHA512_IV[5] | 0;
    this.Dh = SHA512_IV[6] | 0;
    this.Dl = SHA512_IV[7] | 0;
    this.Eh = SHA512_IV[8] | 0;
    this.El = SHA512_IV[9] | 0;
    this.Fh = SHA512_IV[10] | 0;
    this.Fl = SHA512_IV[11] | 0;
    this.Gh = SHA512_IV[12] | 0;
    this.Gl = SHA512_IV[13] | 0;
    this.Hh = SHA512_IV[14] | 0;
    this.Hl = SHA512_IV[15] | 0;
  }
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  process(view, offset) {
    for (let i = 0;i < 16; i++, offset += 4) {
      SHA512_W_H[i] = view.getUint32(offset);
      SHA512_W_L[i] = view.getUint32(offset += 4);
    }
    for (let i = 16;i < 80; i++) {
      const W15h = SHA512_W_H[i - 15] | 0;
      const W15l = SHA512_W_L[i - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i - 2] | 0;
      const W2l = SHA512_W_L[i - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0;
      SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0;i < 80; i++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
}
var sha512 = /* @__PURE__ */ createHasher(() => new SHA512);

// packages/crypto/node_modules/@noble/curves/esm/utils.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function _abool2(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}"`;
    throw new Error(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function _abytes2(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== undefined;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  abytes(bytes);
  return hexToNumber(bytesToHex(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE(n, len) {
  return hexToBytes(n.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function ensureBytes(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes(hex);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(title + " must be hex string or Uint8Array");
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(title + " of length " + expectedLength + " expected, got " + len);
  return res;
}
function equalBytes(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0;i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(bytes);
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  let len;
  for (len = 0;n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function _validateObject(object, fields, optFields = {}) {
  if (!object || typeof object !== "object")
    throw new Error("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    const val = object[fieldName];
    if (isOpt && val === undefined)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
  Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
}
var notImplemented = () => {
  throw new Error("not implemented");
};
function memoized(fn) {
  const map = new WeakMap;
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== undefined)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}

// packages/crypto/node_modules/@noble/curves/esm/abstract/modular.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n2 = BigInt(0);
var _1n2 = BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow2(x, power, modulo) {
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp, root, n) {
  if (!Fp.eql(Fp.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod4(Fp, n) {
  const p1div4 = (Fp.ORDER + _1n2) / _4n;
  const root = Fp.pow(n, p1div4);
  assertIsSquare(Fp, root, n);
  return root;
}
function sqrt5mod8(Fp, n) {
  const p5div8 = (Fp.ORDER - _5n) / _8n;
  const n2 = Fp.mul(n, _2n);
  const v = Fp.pow(n2, p5div8);
  const nv = Fp.mul(n, v);
  const i = Fp.mul(Fp.mul(nv, _2n), v);
  const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
  assertIsSquare(Fp, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return (Fp, n) => {
    let tv1 = Fp.pow(n, c4);
    let tv2 = Fp.mul(tv1, c1);
    const tv3 = Fp.mul(tv1, c2);
    const tv4 = Fp.mul(tv1, c3);
    const e1 = Fp.eql(Fp.sqr(tv2), n);
    const e2 = Fp.eql(Fp.sqr(tv3), n);
    tv1 = Fp.cmov(tv1, tv2, e1);
    tv2 = Fp.cmov(tv4, tv3, e2);
    const e3 = Fp.eql(Fp.sqr(tv2), n);
    const root = Fp.cmov(tv1, tv2, e3);
    assertIsSquare(Fp, root, n);
    return root;
  };
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1000)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp, n) {
    if (Fp.is0(n))
      return n;
    if (FpLegendre(Fp, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = Fp.mul(Fp.ONE, cc);
    let t = Fp.pow(n, Q);
    let R = Fp.pow(n, Q1div2);
    while (!Fp.eql(t, Fp.ONE)) {
      if (Fp.is0(t))
        return Fp.ZERO;
      let i = 1;
      let t_tmp = Fp.sqr(t);
      while (!Fp.eql(t_tmp, Fp.ONE)) {
        i++;
        t_tmp = Fp.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = Fp.pow(c, exponent);
      M = i;
      c = Fp.sqr(b);
      t = Fp.mul(t, c);
      R = Fp.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2;
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  _validateObject(field, opts);
  return field;
}
function FpPow(Fp, num, power) {
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return Fp.ONE;
  if (power === _1n2)
    return num;
  let p = Fp.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = Fp.mul(p, d);
    d = Fp.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp, nums, passZero = false) {
  const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : undefined);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (Fp.is0(num))
      return acc;
    inverted[i] = acc;
    return Fp.mul(acc, num);
  }, Fp.ONE);
  const invertedAcc = Fp.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (Fp.is0(num))
      return acc;
    inverted[i] = Fp.mul(acc, inverted[i]);
    return Fp.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp, n) {
  const p1mod2 = (Fp.ORDER - _1n2) / _2n;
  const powered = Fp.pow(n, p1mod2);
  const yes = Fp.eql(powered, Fp.ONE);
  const zero = Fp.eql(powered, Fp.ZERO);
  const no = Fp.eql(powered, Fp.neg(Fp.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== undefined)
    anumber(nBitLength);
  const _nBitLength = nBitLength !== undefined ? nBitLength : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field(ORDER, bitLenOrOpts, isLE = false, opts = {}) {
  if (ORDER <= _0n2)
    throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
  let _nbitLength = undefined;
  let _sqrt = undefined;
  let modFromBytes = false;
  let allowedLengths = undefined;
  if (typeof bitLenOrOpts === "object" && bitLenOrOpts != null) {
    if (opts.sqrt || isLE)
      throw new Error("cannot specify opts in two arguments");
    const _opts = bitLenOrOpts;
    if (_opts.BITS)
      _nbitLength = _opts.BITS;
    if (_opts.sqrt)
      _sqrt = _opts.sqrt;
    if (typeof _opts.isLE === "boolean")
      isLE = _opts.isLE;
    if (typeof _opts.modFromBytes === "boolean")
      modFromBytes = _opts.modFromBytes;
    allowedLengths = _opts.allowedLengths;
  } else {
    if (typeof bitLenOrOpts === "number")
      _nbitLength = bitLenOrOpts;
    if (opts.sqrt)
      _sqrt = opts.sqrt;
  }
  const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
  if (BYTES > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let sqrtP;
  const f = Object.freeze({
    ORDER,
    isLE,
    BITS,
    BYTES,
    MASK: bitMask(BITS),
    ZERO: _0n2,
    ONE: _1n2,
    allowedLengths,
    create: (num) => mod(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num);
      return _0n2 <= num && num < ORDER;
    },
    is0: (num) => num === _0n2,
    isValidNot0: (num) => !f.is0(num) && f.isValid(num),
    isOdd: (num) => (num & _1n2) === _1n2,
    neg: (num) => mod(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod(num * num, ORDER),
    add: (lhs, rhs) => mod(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
    pow: (num, power) => FpPow(f, num, power),
    div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert(num, ORDER),
    sqrt: _sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt(ORDER);
      return sqrtP(f, n);
    }),
    toBytes: (num) => isLE ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
    fromBytes: (bytes, skipValidation = true) => {
      if (allowedLengths) {
        if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
          throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
        }
        const padded = new Uint8Array(BYTES);
        padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
        bytes = padded;
      }
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
      if (modFromBytes)
        scalar = mod(scalar, ORDER);
      if (!skipValidation) {
        if (!f.isValid(scalar))
          throw new Error("invalid field element: outside of range 0..ORDER");
      }
      return scalar;
    },
    invertBatch: (lst) => FpInvertBatch(f, lst),
    cmov: (a, b, c) => c ? b : a
  });
  return Object.freeze(f);
}

// packages/crypto/node_modules/@noble/curves/esm/abstract/curve.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n3 = BigInt(0);
var _1n3 = BigInt(1);
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ(c, points) {
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
function validateMSMPoints(points, c) {
  if (!Array.isArray(points))
    throw new Error("array expected");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    if (!field.isValid(s))
      throw new Error("invalid scalar at index " + i);
  });
}
var pointPrecomputes = new WeakMap;
var pointWindowSizes = new WeakMap;
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
  if (n !== _0n3)
    throw new Error("invalid wNAF");
}

class wNAF {
  constructor(Point, bits) {
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.Fn = Point.Fn;
    this.bits = bits;
  }
  _unsafeLadder(elm, n, p = this.ZERO) {
    let d = elm;
    while (n > _0n3) {
      if (n & _1n3)
        p = p.add(d);
      d = d.double();
      n >>= _1n3;
    }
    return p;
  }
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window = 0;window < windows; window++) {
      base = p;
      points.push(base);
      for (let i = 1;i < windowSize; i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }
  wNAF(W, precomputes, n) {
    if (!this.Fn.isValid(n))
      throw new Error("invalid scalar");
    let p = this.ZERO;
    let f = this.BASE;
    const wo = calcWOpts(W, this.bits);
    for (let window = 0;window < wo.windows; window++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        f = f.add(negateCt(isNegF, precomputes[offsetF]));
      } else {
        p = p.add(negateCt(isNeg, precomputes[offset]));
      }
    }
    assert0(n);
    return { p, f };
  }
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W, this.bits);
    for (let window = 0;window < wo.windows; window++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        continue;
      } else {
        const item = precomputes[offset];
        acc = acc.add(isNeg ? item.negate() : item);
      }
    }
    assert0(n);
    return acc;
  }
  getPrecomputes(W, point, transform) {
    let comp = pointPrecomputes.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W);
      if (W !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W = getW(point);
    return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W = getW(point);
    if (W === 1)
      return this._unsafeLadder(point, scalar, prev);
    return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
  }
  createCache(P, W) {
    validateW(W, this.bits);
    pointWindowSizes.set(P, W);
    pointPrecomputes.delete(P);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
}
function pippenger(c, fieldN, points, scalars) {
  validateMSMPoints(points, c);
  validateMSMScalars(scalars, fieldN);
  const plength = points.length;
  const slength = scalars.length;
  if (plength !== slength)
    throw new Error("arrays of points and scalars must have equal length");
  const zero = c.ZERO;
  const wbits = bitLen(BigInt(plength));
  let windowSize = 1;
  if (wbits > 12)
    windowSize = wbits - 3;
  else if (wbits > 4)
    windowSize = wbits - 2;
  else if (wbits > 0)
    windowSize = 2;
  const MASK = bitMask(windowSize);
  const buckets = new Array(Number(MASK) + 1).fill(zero);
  const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
  let sum = zero;
  for (let i = lastBits;i >= 0; i -= windowSize) {
    buckets.fill(zero);
    for (let j = 0;j < slength; j++) {
      const scalar = scalars[j];
      const wbits = Number(scalar >> BigInt(i) & MASK);
      buckets[wbits] = buckets[wbits].add(points[j]);
    }
    let resI = zero;
    for (let j = buckets.length - 1, sumI = zero;j > 0; j--) {
      sumI = sumI.add(buckets[j]);
      resI = resI.add(sumI);
    }
    sum = sum.add(resI);
    if (i !== 0)
      for (let j = 0;j < windowSize; j++)
        sum = sum.double();
  }
  return sum;
}
function createField(order, field, isLE) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE });
  }
}
function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === undefined)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}

// packages/crypto/node_modules/@noble/curves/esm/abstract/edwards.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n2 = BigInt(2);
var _8n2 = BigInt(8);
function isEdValidXY(Fp, CURVE, x, y) {
  const x2 = Fp.sqr(x);
  const y2 = Fp.sqr(y);
  const left = Fp.add(Fp.mul(CURVE.a, x2), y2);
  const right = Fp.add(Fp.ONE, Fp.mul(CURVE.d, Fp.mul(x2, y2)));
  return Fp.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  const validated = _createCurveFields("edwards", params, extraOpts, extraOpts.FpFnLE);
  const { Fp, Fn } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  _validateObject(extraOpts, {}, { uvRatio: "function" });
  const MASK = _2n2 << BigInt(Fn.BYTES * 8) - _1n4;
  const modP = (n) => Fp.create(n);
  const uvRatio = extraOpts.uvRatio || ((u, v) => {
    try {
      return { isValid: true, value: Fp.sqrt(Fp.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n4 };
    }
  });
  if (!isEdValidXY(Fp, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n4 : _0n4;
    aInRange("coordinate " + title, n, min, MASK);
    return n;
  }
  function aextpoint(other) {
    if (!(other instanceof Point))
      throw new Error("ExtendedPoint expected");
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? _8n2 : Fp.inv(Z);
    const x = modP(X * iz);
    const y = modP(Y * iz);
    const zz = Fp.mul(Z, iz);
    if (is0)
      return { x: _0n4, y: _1n4 };
    if (zz !== _1n4)
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    const { a, d } = CURVE;
    if (p.is0())
      throw new Error("bad point: ZERO");
    const { X, Y, Z, T } = p;
    const X2 = modP(X * X);
    const Y2 = modP(Y * Y);
    const Z2 = modP(Z * Z);
    const Z4 = modP(Z2 * Z2);
    const aX2 = modP(X2 * a);
    const left = modP(Z2 * modP(aX2 + Y2));
    const right = modP(Z4 + modP(d * modP(X2 * Y2)));
    if (left !== right)
      throw new Error("bad point: equation left != right (1)");
    const XY = modP(X * Y);
    const ZT = modP(Z * T);
    if (XY !== ZT)
      throw new Error("bad point: equation left != right (2)");
    return true;
  });

  class Point {
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point(x, y, _1n4, modP(x * y));
    }
    static fromBytes(bytes, zip215 = false) {
      const len = Fp.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes(_abytes2(bytes, len, "point"));
      _abool2(zip215, "zip215");
      const normed = copyBytes(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp.ORDER;
      aInRange("point.y", y, _0n4, max);
      const y2 = modP(y * y);
      const u = modP(y2 - _1n4);
      const v = modP(d * y2 - a);
      let { isValid, value: x } = uvRatio(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = (x & _1n4) === _1n4;
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && x === _0n4 && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = modP(-x);
      return Point.fromAffine({ x, y });
    }
    static fromHex(bytes, zip215 = false) {
      return Point.fromBytes(ensureBytes("point", bytes), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_2n2);
      return this;
    }
    assertValidity() {
      assertValidMemo(this);
    }
    equals(other) {
      aextpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = modP(X1 * Z2);
      const X2Z1 = modP(X2 * Z1);
      const Y1Z2 = modP(Y1 * Z2);
      const Y2Z1 = modP(Y2 * Z1);
      return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(modP(-this.X), this.Y, this.Z, modP(-this.T));
    }
    double() {
      const { a } = CURVE;
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = modP(X1 * X1);
      const B = modP(Y1 * Y1);
      const C = modP(_2n2 * modP(Z1 * Z1));
      const D = modP(a * A);
      const x1y1 = X1 + Y1;
      const E = modP(modP(x1y1 * x1y1) - A - B);
      const G = D + B;
      const F = G - C;
      const H = D - B;
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point(X3, Y3, Z3, T3);
    }
    add(other) {
      aextpoint(other);
      const { a, d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = modP(X1 * X2);
      const B = modP(Y1 * Y2);
      const C = modP(T1 * d * T2);
      const D = modP(Z1 * Z2);
      const E = modP((X1 + Y1) * (X2 + Y2) - A - B);
      const F = D - C;
      const G = D + C;
      const H = modP(B - a * A);
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new Error("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.cached(this, scalar, (p) => normalizeZ(Point, p));
      return normalizeZ(Point, [p, f])[0];
    }
    multiplyUnsafe(scalar, acc = Point.ZERO) {
      if (!Fn.isValid(scalar))
        throw new Error("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n4)
        return Point.ZERO;
      if (this.is0() || scalar === _1n4)
        return this;
      return wnaf.unsafe(this, scalar, (p) => normalizeZ(Point, p), acc);
    }
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    isTorsionFree() {
      return wnaf.unsafe(this, CURVE.n).is0();
    }
    toAffine(invertedZ) {
      return toAffineMemo(this, invertedZ);
    }
    clearCofactor() {
      if (cofactor === _1n4)
        return this;
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp.toBytes(y);
      bytes[bytes.length - 1] |= x & _1n4 ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
    get ex() {
      return this.X;
    }
    get ey() {
      return this.Y;
    }
    get ez() {
      return this.Z;
    }
    get et() {
      return this.T;
    }
    static normalizeZ(points) {
      return normalizeZ(Point, points);
    }
    static msm(points, scalars) {
      return pippenger(Point, Fn, points, scalars);
    }
    _setWindowSize(windowSize) {
      this.precompute(windowSize);
    }
    toRawBytes() {
      return this.toBytes();
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, _1n4, modP(CURVE.Gx * CURVE.Gy));
  Point.ZERO = new Point(_0n4, _1n4, _1n4, _0n4);
  Point.Fp = Fp;
  Point.Fn = Fn;
  const wnaf = new wNAF(Point, Fn.BITS);
  Point.BASE.precompute(8);
  return Point;
}

class PrimeEdwardsPoint {
  constructor(ep) {
    this.ep = ep;
  }
  static fromBytes(_bytes) {
    notImplemented();
  }
  static fromHex(_hex) {
    notImplemented();
  }
  get x() {
    return this.toAffine().x;
  }
  get y() {
    return this.toAffine().y;
  }
  clearCofactor() {
    return this;
  }
  assertValidity() {
    this.ep.assertValidity();
  }
  toAffine(invertedZ) {
    return this.ep.toAffine(invertedZ);
  }
  toHex() {
    return bytesToHex(this.toBytes());
  }
  toString() {
    return this.toHex();
  }
  isTorsionFree() {
    return true;
  }
  isSmallOrder() {
    return false;
  }
  add(other) {
    this.assertSame(other);
    return this.init(this.ep.add(other.ep));
  }
  subtract(other) {
    this.assertSame(other);
    return this.init(this.ep.subtract(other.ep));
  }
  multiply(scalar) {
    return this.init(this.ep.multiply(scalar));
  }
  multiplyUnsafe(scalar) {
    return this.init(this.ep.multiplyUnsafe(scalar));
  }
  double() {
    return this.init(this.ep.double());
  }
  negate() {
    return this.init(this.ep.negate());
  }
  precompute(windowSize, isLazy) {
    return this.init(this.ep.precompute(windowSize, isLazy));
  }
  toRawBytes() {
    return this.toBytes();
  }
}
function eddsa(Point, cHash, eddsaOpts = {}) {
  if (typeof cHash !== "function")
    throw new Error('"hash" function param is required');
  _validateObject(eddsaOpts, {}, {
    adjustScalarBytes: "function",
    randomBytes: "function",
    domain: "function",
    prehash: "function",
    mapToCurve: "function"
  });
  const { prehash } = eddsaOpts;
  const { BASE, Fp, Fn } = Point;
  const randomBytes = eddsaOpts.randomBytes || randomBytes3;
  const adjustScalarBytes = eddsaOpts.adjustScalarBytes || ((bytes) => bytes);
  const domain = eddsaOpts.domain || ((data, ctx, phflag) => {
    _abool2(phflag, "phflag");
    if (ctx.length || phflag)
      throw new Error("Contexts/pre-hash are not supported");
    return data;
  });
  function modN_LE(hash) {
    return Fn.create(bytesToNumberLE(hash));
  }
  function getPrivateScalar(key) {
    const len = lengths.secretKey;
    key = ensureBytes("private key", key, len);
    const hashed = ensureBytes("hashed private key", cHash(key), 2 * len);
    const head = adjustScalarBytes(hashed.slice(0, len));
    const prefix = hashed.slice(len, 2 * len);
    const scalar = modN_LE(head);
    return { head, prefix, scalar };
  }
  function getExtendedPublicKey(secretKey) {
    const { head, prefix, scalar } = getPrivateScalar(secretKey);
    const point = BASE.multiply(scalar);
    const pointBytes = point.toBytes();
    return { head, prefix, scalar, point, pointBytes };
  }
  function getPublicKey(secretKey) {
    return getExtendedPublicKey(secretKey).pointBytes;
  }
  function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
    const msg = concatBytes(...msgs);
    return modN_LE(cHash(domain(msg, ensureBytes("context", context), !!prehash)));
  }
  function sign(msg, secretKey, options = {}) {
    msg = ensureBytes("message", msg);
    if (prehash)
      msg = prehash(msg);
    const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey);
    const r = hashDomainToScalar(options.context, prefix, msg);
    const R = BASE.multiply(r).toBytes();
    const k = hashDomainToScalar(options.context, R, pointBytes, msg);
    const s = Fn.create(r + k * scalar);
    if (!Fn.isValid(s))
      throw new Error("sign failed: invalid s");
    const rs = concatBytes(R, Fn.toBytes(s));
    return _abytes2(rs, lengths.signature, "result");
  }
  const verifyOpts = { zip215: true };
  function verify(sig, msg, publicKey, options = verifyOpts) {
    const { context, zip215 } = options;
    const len = lengths.signature;
    sig = ensureBytes("signature", sig, len);
    msg = ensureBytes("message", msg);
    publicKey = ensureBytes("publicKey", publicKey, lengths.publicKey);
    if (zip215 !== undefined)
      _abool2(zip215, "zip215");
    if (prehash)
      msg = prehash(msg);
    const mid = len / 2;
    const r = sig.subarray(0, mid);
    const s = bytesToNumberLE(sig.subarray(mid, len));
    let A, R, SB;
    try {
      A = Point.fromBytes(publicKey, zip215);
      R = Point.fromBytes(r, zip215);
      SB = BASE.multiplyUnsafe(s);
    } catch (error) {
      return false;
    }
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = hashDomainToScalar(context, R.toBytes(), A.toBytes(), msg);
    const RkA = R.add(A.multiplyUnsafe(k));
    return RkA.subtract(SB).clearCofactor().is0();
  }
  const _size = Fp.BYTES;
  const lengths = {
    secretKey: _size,
    publicKey: _size,
    signature: 2 * _size,
    seed: _size
  };
  function randomSecretKey(seed = randomBytes(lengths.seed)) {
    return _abytes2(seed, lengths.seed, "seed");
  }
  function keygen(seed) {
    const secretKey = utils.randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  }
  function isValidSecretKey(key) {
    return isBytes(key) && key.length === Fn.BYTES;
  }
  function isValidPublicKey(key, zip215) {
    try {
      return !!Point.fromBytes(key, zip215);
    } catch (error) {
      return false;
    }
  }
  const utils = {
    getExtendedPublicKey,
    randomSecretKey,
    isValidSecretKey,
    isValidPublicKey,
    toMontgomery(publicKey) {
      const { y } = Point.fromBytes(publicKey);
      const size = lengths.publicKey;
      const is25519 = size === 32;
      if (!is25519 && size !== 57)
        throw new Error("only defined for 25519 and 448");
      const u = is25519 ? Fp.div(_1n4 + y, _1n4 - y) : Fp.div(y - _1n4, y + _1n4);
      return Fp.toBytes(u);
    },
    toMontgomerySecret(secretKey) {
      const size = lengths.secretKey;
      _abytes2(secretKey, size);
      const hashed = cHash(secretKey.subarray(0, size));
      return adjustScalarBytes(hashed).subarray(0, size);
    },
    randomPrivateKey: randomSecretKey,
    precompute(windowSize = 8, point = Point.BASE) {
      return point.precompute(windowSize, false);
    }
  };
  return Object.freeze({
    keygen,
    getPublicKey,
    sign,
    verify,
    utils,
    Point,
    lengths
  });
}
function _eddsa_legacy_opts_to_new(c) {
  const CURVE = {
    a: c.a,
    d: c.d,
    p: c.Fp.ORDER,
    n: c.n,
    h: c.h,
    Gx: c.Gx,
    Gy: c.Gy
  };
  const Fp = c.Fp;
  const Fn = Field(CURVE.n, c.nBitLength, true);
  const curveOpts = { Fp, Fn, uvRatio: c.uvRatio };
  const eddsaOpts = {
    randomBytes: c.randomBytes,
    adjustScalarBytes: c.adjustScalarBytes,
    domain: c.domain,
    prehash: c.prehash,
    mapToCurve: c.mapToCurve
  };
  return { CURVE, curveOpts, hash: c.hash, eddsaOpts };
}
function _eddsa_new_output_to_legacy(c, eddsa) {
  const Point = eddsa.Point;
  const legacy = Object.assign({}, eddsa, {
    ExtendedPoint: Point,
    CURVE: c,
    nBitLength: Point.Fn.BITS,
    nByteLength: Point.Fn.BYTES
  });
  return legacy;
}
function twistedEdwards(c) {
  const { CURVE, curveOpts, hash, eddsaOpts } = _eddsa_legacy_opts_to_new(c);
  const Point = edwards(CURVE, curveOpts);
  const EDDSA = eddsa(Point, hash, eddsaOpts);
  return _eddsa_new_output_to_legacy(c, EDDSA);
}

// packages/crypto/node_modules/@noble/curves/esm/abstract/montgomery.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n3 = BigInt(2);
function validateOpts(curve) {
  _validateObject(curve, {
    adjustScalarBytes: "function",
    powPminus2: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { P, type, adjustScalarBytes, powPminus2, randomBytes: rand } = CURVE;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand || randomBytes3;
  const montgomeryBits = is25519 ? 255 : 448;
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n3 ** BigInt(254) : _2n3 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * _2n3 ** BigInt(251) - _1n5 : BigInt(4) * _2n3 ** BigInt(445) - _1n5;
  const maxScalar = minScalar + maxAdded + _1n5;
  const modP = (n) => mod(n, P);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = ensureBytes("u coordinate", u, fieldLen);
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE(adjustScalarBytes(ensureBytes("scalar", scalar, fieldLen)));
  }
  function scalarMult(scalar, u) {
    const pu = montgomeryLadder(decodeU(u), decodeScalar(scalar));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    return scalarMult(scalar, GuBytes);
  }
  function cswap(swap, x_2, x_3) {
    const dummy = modP(swap * (x_2 - x_3));
    x_2 = modP(x_2 - dummy);
    x_3 = modP(x_3 + dummy);
    return { x_2, x_3 };
  }
  function montgomeryLadder(u, scalar) {
    aInRange("u", u, _0n5, P);
    aInRange("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n5;
    let z_2 = _0n5;
    let x_3 = u;
    let z_3 = _1n5;
    let swap = _0n5;
    for (let t = BigInt(montgomeryBits - 1);t >= _0n5; t--) {
      const k_t = k >> t & _1n5;
      swap ^= k_t;
      ({ x_2, x_3 } = cswap(swap, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
      swap = k_t;
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    ({ x_2, x_3 } = cswap(swap, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey = (seed = randomBytes_(fieldLen)) => {
    abytes(seed, lengths.seed);
    return seed;
  };
  function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: scalarMultBase(secretKey) };
  }
  const utils = {
    randomSecretKey,
    randomPrivateKey: randomSecretKey
  };
  return {
    keygen,
    getSharedSecret: (secretKey, publicKey) => scalarMult(secretKey, publicKey),
    getPublicKey: (secretKey) => scalarMultBase(secretKey),
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  };
}

// packages/crypto/node_modules/@noble/curves/esm/ed25519.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n6 = /* @__PURE__ */ BigInt(0);
var _1n6 = BigInt(1);
var _2n4 = BigInt(2);
var _3n2 = BigInt(3);
var _5n2 = BigInt(5);
var _8n3 = BigInt(8);
var ed25519_CURVE_p = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n3,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_3(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ed25519_CURVE_p;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow2(b2, _2n4, P) * b2 % P;
  const b5 = pow2(b4, _1n6, P) * x % P;
  const b10 = pow2(b5, _5n2, P) * b5 % P;
  const b20 = pow2(b10, _10n, P) * b10 % P;
  const b40 = pow2(b20, _20n, P) * b20 % P;
  const b80 = pow2(b40, _40n, P) * b40 % P;
  const b160 = pow2(b80, _80n, P) * b80 % P;
  const b240 = pow2(b160, _80n, P) * b80 % P;
  const b250 = pow2(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow2(b250, _2n4, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
  const P = ed25519_CURVE_p;
  const v3 = mod(v * v * v, P);
  const v7 = mod(v3 * v3 * v, P);
  const pow = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow, P);
  const vx2 = mod(v * x * x, P);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P))
    x = mod(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var Fp = /* @__PURE__ */ (() => Field(ed25519_CURVE.p, { isLE: true }))();
var Fn = /* @__PURE__ */ (() => Field(ed25519_CURVE.n, { isLE: true }))();
var ed25519Defaults = /* @__PURE__ */ (() => ({
  ...ed25519_CURVE,
  Fp,
  hash: sha512,
  adjustScalarBytes,
  uvRatio
}))();
var ed25519 = /* @__PURE__ */ (() => twistedEdwards(ed25519Defaults))();
var x25519 = /* @__PURE__ */ (() => {
  const P = Fp.ORDER;
  return montgomery({
    P,
    type: "x25519",
    powPminus2: (x) => {
      const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
      return mod(pow2(pow_p_5_8, _3n2, P) * b2, P);
    },
    adjustScalarBytes
  });
})();
var SQRT_M1 = ED25519_SQRT_M1;
var SQRT_AD_MINUS_ONE = /* @__PURE__ */ BigInt("25063068953384623474111414158702152701244531502492656460079210482610430750235");
var INVSQRT_A_MINUS_D = /* @__PURE__ */ BigInt("54469307008909316920995813868745141605393597292927456921205312896311721017578");
var ONE_MINUS_D_SQ = /* @__PURE__ */ BigInt("1159843021668779879193775521855586647937357759715417654439879720876111806838");
var D_MINUS_ONE_SQ = /* @__PURE__ */ BigInt("40440834346308536858101042469323190826248399146238708352240133220865137265952");
var invertSqrt = (number) => uvRatio(_1n6, number);
var MAX_255B = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var bytes255ToNumberLE = (bytes) => ed25519.Point.Fp.create(bytesToNumberLE(bytes) & MAX_255B);
function calcElligatorRistrettoMap(r0) {
  const { d } = ed25519_CURVE;
  const P = ed25519_CURVE_p;
  const mod = (n) => Fp.create(n);
  const r = mod(SQRT_M1 * r0 * r0);
  const Ns = mod((r + _1n6) * ONE_MINUS_D_SQ);
  let c = BigInt(-1);
  const D = mod((c - d * r) * mod(r + d));
  let { isValid: Ns_D_is_sq, value: s } = uvRatio(Ns, D);
  let s_ = mod(s * r0);
  if (!isNegativeLE(s_, P))
    s_ = mod(-s_);
  if (!Ns_D_is_sq)
    s = s_;
  if (!Ns_D_is_sq)
    c = r;
  const Nt = mod(c * (r - _1n6) * D_MINUS_ONE_SQ - D);
  const s2 = s * s;
  const W0 = mod((s + s) * D);
  const W1 = mod(Nt * SQRT_AD_MINUS_ONE);
  const W2 = mod(_1n6 - s2);
  const W3 = mod(_1n6 + s2);
  return new ed25519.Point(mod(W0 * W3), mod(W2 * W1), mod(W1 * W3), mod(W0 * W2));
}
function ristretto255_map(bytes) {
  abytes(bytes, 64);
  const r1 = bytes255ToNumberLE(bytes.subarray(0, 32));
  const R1 = calcElligatorRistrettoMap(r1);
  const r2 = bytes255ToNumberLE(bytes.subarray(32, 64));
  const R2 = calcElligatorRistrettoMap(r2);
  return new _RistrettoPoint(R1.add(R2));
}

class _RistrettoPoint extends PrimeEdwardsPoint {
  constructor(ep) {
    super(ep);
  }
  static fromAffine(ap) {
    return new _RistrettoPoint(ed25519.Point.fromAffine(ap));
  }
  assertSame(other) {
    if (!(other instanceof _RistrettoPoint))
      throw new Error("RistrettoPoint expected");
  }
  init(ep) {
    return new _RistrettoPoint(ep);
  }
  static hashToCurve(hex) {
    return ristretto255_map(ensureBytes("ristrettoHash", hex, 64));
  }
  static fromBytes(bytes) {
    abytes(bytes, 32);
    const { a, d } = ed25519_CURVE;
    const P = ed25519_CURVE_p;
    const mod = (n) => Fp.create(n);
    const s = bytes255ToNumberLE(bytes);
    if (!equalBytes(Fp.toBytes(s), bytes) || isNegativeLE(s, P))
      throw new Error("invalid ristretto255 encoding 1");
    const s2 = mod(s * s);
    const u1 = mod(_1n6 + a * s2);
    const u2 = mod(_1n6 - a * s2);
    const u1_2 = mod(u1 * u1);
    const u2_2 = mod(u2 * u2);
    const v = mod(a * d * u1_2 - u2_2);
    const { isValid, value: I } = invertSqrt(mod(v * u2_2));
    const Dx = mod(I * u2);
    const Dy = mod(I * Dx * v);
    let x = mod((s + s) * Dx);
    if (isNegativeLE(x, P))
      x = mod(-x);
    const y = mod(u1 * Dy);
    const t = mod(x * y);
    if (!isValid || isNegativeLE(t, P) || y === _0n6)
      throw new Error("invalid ristretto255 encoding 2");
    return new _RistrettoPoint(new ed25519.Point(x, y, _1n6, t));
  }
  static fromHex(hex) {
    return _RistrettoPoint.fromBytes(ensureBytes("ristrettoHex", hex, 32));
  }
  static msm(points, scalars) {
    return pippenger(_RistrettoPoint, ed25519.Point.Fn, points, scalars);
  }
  toBytes() {
    let { X, Y, Z, T } = this.ep;
    const P = ed25519_CURVE_p;
    const mod = (n) => Fp.create(n);
    const u1 = mod(mod(Z + Y) * mod(Z - Y));
    const u2 = mod(X * Y);
    const u2sq = mod(u2 * u2);
    const { value: invsqrt } = invertSqrt(mod(u1 * u2sq));
    const D1 = mod(invsqrt * u1);
    const D2 = mod(invsqrt * u2);
    const zInv = mod(D1 * D2 * T);
    let D;
    if (isNegativeLE(T * zInv, P)) {
      let _x = mod(Y * SQRT_M1);
      let _y = mod(X * SQRT_M1);
      X = _x;
      Y = _y;
      D = mod(D1 * INVSQRT_A_MINUS_D);
    } else {
      D = D2;
    }
    if (isNegativeLE(X * zInv, P))
      Y = mod(-Y);
    let s = mod((Z - Y) * D);
    if (isNegativeLE(s, P))
      s = mod(-s);
    return Fp.toBytes(s);
  }
  equals(other) {
    this.assertSame(other);
    const { X: X1, Y: Y1 } = this.ep;
    const { X: X2, Y: Y2 } = other.ep;
    const mod = (n) => Fp.create(n);
    const one = mod(X1 * Y2) === mod(Y1 * X2);
    const two = mod(Y1 * Y2) === mod(X1 * X2);
    return one || two;
  }
  is0() {
    return this.equals(_RistrettoPoint.ZERO);
  }
}
_RistrettoPoint.BASE = /* @__PURE__ */ (() => new _RistrettoPoint(ed25519.Point.BASE))();
_RistrettoPoint.ZERO = /* @__PURE__ */ (() => new _RistrettoPoint(ed25519.Point.ZERO))();
_RistrettoPoint.Fp = /* @__PURE__ */ (() => Fp)();
_RistrettoPoint.Fn = /* @__PURE__ */ (() => Fn)();

// node_modules/@lukeburns/clatterjs/dist/constants.js
var MAX_KEY_LEN = 32;
var MAX_TAG_LEN = 16;
var MAX_MESSAGE_LEN = 65535;
var PSK_LEN = 32;
var MAX_PSKS = 4;
var MAX_TOKENS_PER_HS_MESSAGE = 8;
var MAX_HS_MESSAGES_PER_ROLE = 8;
var HYBRID_DUAL_LAYER = new TextEncoder().encode("clatter.hybrid_dual_layer.outer");
// node_modules/@lukeburns/clatterjs/dist/errors.js
class CipherError extends Error {
  code;
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = "CipherError";
  }
}

class HandshakeError extends Error {
  code;
  causeErr;
  constructor(code, message, causeErr) {
    super(message ?? code);
    this.code = code;
    this.causeErr = causeErr;
    this.name = "HandshakeError";
  }
}

class PatternError extends Error {
  kind;
  constructor(kind, message) {
    super(message ?? kind);
    this.kind = kind;
    this.name = "PatternError";
  }
}

class TransportError extends Error {
  code;
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = "TransportError";
  }
}
// node_modules/@lukeburns/clatterjs/dist/handshakePattern.js
function checkMsgLens(initiator, responder) {
  for (const g of initiator) {
    if (g.length > MAX_TOKENS_PER_HS_MESSAGE) {
      throw new Error("Too many tokens in one handshake message");
    }
  }
  for (const g of responder) {
    if (g.length > MAX_TOKENS_PER_HS_MESSAGE) {
      throw new Error("Too many tokens in one handshake message");
    }
  }
  if (initiator.length > MAX_HS_MESSAGES_PER_ROLE || responder.length > MAX_HS_MESSAGES_PER_ROLE) {
    throw new Error("Too many handshake messages per role");
  }
}
function hasKemTokens(m) {
  const k = (tok) => tok === 6 || tok === 7;
  return m.initiator.some((g) => g.some(k)) || m.responder.some((g) => g.some(k));
}
function hasDhTokens(m) {
  const k = (tok) => tok === 2 || tok === 3 || tok === 4 || tok === 5;
  return m.initiator.some((g) => g.some(k)) || m.responder.some((g) => g.some(k));
}
function messagePatternHasPsk(m) {
  return m.initiator.some((g) => g.includes(8)) || m.responder.some((g) => g.includes(8));
}
function validatePqTokenOrderRule(messages) {
  for (const message of messages) {
    let skemSeen = false;
    let publicKeySeen = false;
    for (const token of message) {
      if (token === 6) {
        if (publicKeySeen)
          throw new PatternError("PqTokenOrderViolation");
        if (skemSeen)
          throw new PatternError("PqTokenOrderViolation");
      } else if (token === 7) {
        skemSeen = true;
        if (publicKeySeen)
          throw new PatternError("PqTokenOrderViolation");
      } else if (token === 0 || token === 1) {
        publicKeySeen = true;
      }
    }
  }
}
function validatePskRule(messages) {
  let pskSent = false;
  for (const message of messages) {
    for (const token of message) {
      if (token === 8) {
        pskSent = true;
      } else if (token === 0 || token === 6) {
        return;
      } else if (token === 7) {
        if (pskSent)
          throw new PatternError("PskValidityViolation");
        return;
      } else if (token === 1) {
        if (pskSent)
          throw new PatternError("PskValidityViolation");
      }
    }
  }
}

class HandshakePattern {
  name;
  hasPskFlag;
  hsType;
  preInitiator;
  preResponder;
  messagePattern;
  constructor(name, preInitiator, preResponder, initiator, responder) {
    this.name = name;
    checkMsgLens(initiator, responder);
    this.preInitiator = [...preInitiator];
    this.preResponder = [...preResponder];
    this.messagePattern = {
      initiator: initiator.map((a) => [...a]),
      responder: responder.map((a) => [...a])
    };
    const hasKem = hasKemTokens(this.messagePattern);
    const hasDh = hasDhTokens(this.messagePattern);
    if (hasKem && hasDh) {
      this.hsType = 2;
    } else if (hasKem) {
      this.hsType = 1;
    } else if (hasDh) {
      this.hsType = 0;
    } else {
      throw new Error("Invalid handshake pattern");
    }
    this.hasPskFlag = messagePatternHasPsk(this.messagePattern);
    if (this.hasPskFlag) {
      validatePskRule(this.messagePattern.initiator);
      validatePskRule(this.messagePattern.responder);
    }
    if (hasKem) {
      validatePqTokenOrderRule(this.messagePattern.initiator);
      validatePqTokenOrderRule(this.messagePattern.responder);
    }
  }
  getMessagePattern() {
    return this.messagePattern;
  }
  getInitiatorPatternLen() {
    return this.messagePattern.initiator.length;
  }
  getResponderPatternLen() {
    return this.messagePattern.responder.length;
  }
  getInitiatorPreShared() {
    return this.preInitiator;
  }
  getResponderPreShared() {
    return this.preResponder;
  }
  getInitiatorPattern(i) {
    return this.messagePattern.initiator[i] ?? [];
  }
  getResponderPattern(i) {
    return this.messagePattern.responder[i] ?? [];
  }
  hasPsk() {
    return this.hasPskFlag;
  }
  getName() {
    return this.name;
  }
  isOneWay() {
    return this.messagePattern.responder.length === 0;
  }
  getType() {
    return this.hsType;
  }
  addPsks(positions, newName) {
    const initiator = this.messagePattern.initiator.map((a) => [...a]);
    const responder = this.messagePattern.responder.map((a) => [...a]);
    for (const pos of positions) {
      if (pos === 0) {
        (initiator[0] ??= []).unshift(8);
      } else if (pos % 2 === 0) {
        const r = pos / 2 - 1;
        (responder[r] ??= []).push(8);
      } else {
        const ii = (pos - 1) / 2;
        (initiator[ii] ??= []).push(8);
      }
    }
    return new HandshakePattern(newName, this.preInitiator, this.preResponder, initiator, responder);
  }
}
// node_modules/@lukeburns/clatterjs/dist/cipherState.js
var U64_MAX = 0xfffffffffffffffn;

class CipherState {
  C;
  key;
  n = 0n;
  overflowed = false;
  constructor(C, k, startNonce) {
    this.C = C;
    this.key = Uint8Array.from(k);
    this.n = startNonce;
  }
  getNonce() {
    return this.n;
  }
  setNonce(n) {
    this.n = n;
  }
  getKey() {
    return Uint8Array.from(this.key);
  }
  encryptWithAd(ad, plaintext, out) {
    if (this.overflowed)
      throw new CipherError("NonceOverflow");
    this.C.encrypt(this.key, this.n, ad, plaintext, out);
    this.bumpNonce();
  }
  encryptWithAdInPlace(ad, inOut, plaintextLen) {
    if (this.overflowed)
      throw new CipherError("NonceOverflow");
    const len = this.C.encryptInPlace(this.key, this.n, ad, inOut, plaintextLen);
    this.bumpNonce();
    return len;
  }
  decryptWithAd(ad, ciphertext, out) {
    if (this.overflowed)
      throw new CipherError("NonceOverflow");
    this.C.decrypt(this.key, this.n, ad, ciphertext, out);
    this.bumpNonce();
  }
  decryptWithAdInPlace(ad, inOut, ciphertextLen) {
    if (this.overflowed)
      throw new CipherError("NonceOverflow");
    const len = this.C.decryptInPlace(this.key, this.n, ad, inOut, ciphertextLen);
    this.bumpNonce();
    return len;
  }
  rekey() {
    this.key.set(this.C.rekey(this.key));
  }
  bumpNonce() {
    if (this.n === U64_MAX) {
      this.overflowed = true;
      return;
    }
    this.n += 1n;
  }
}

class CipherStates {
  initiatorToResponder;
  responderToInitiator;
  constructor(initiatorToResponder, responderToInitiator) {
    this.initiatorToResponder = initiatorToResponder;
    this.responderToInitiator = responderToInitiator;
  }
}

// node_modules/@lukeburns/clatterjs/dist/symmetricState.js
function deriveCipherKey(temp, C) {
  return temp.slice(0, C.keyLen);
}

class SymmetricState {
  C;
  H;
  cipherstate;
  h;
  ck;
  constructor(C, H, noisePatternName) {
    this.C = C;
    this.H = H;
    const nb = new TextEncoder().encode(noisePatternName);
    this.h = H.newOutput();
    this.ck = H.newOutput();
    this.h.fill(0);
    if (nb.length <= H.hashLen) {
      this.h.set(nb, 0);
    } else {
      this.h.set(H.hash(nb).subarray(0, H.hashLen));
    }
    this.ck.set(this.h);
  }
  mixHash(data) {
    this.h.set(this.H.hash(concat(this.h, data)).subarray(0, this.H.hashLen));
  }
  mixKey(inputKeyMaterial) {
    const [ck, temp] = this.H.hkdf(this.ck, inputKeyMaterial);
    this.ck.set(ck.subarray(0, this.H.hashLen));
    const k = deriveCipherKey(temp, this.C);
    this.cipherstate = new CipherState(this.C, k, 0n);
  }
  mixKeyAndHash(inputKeyMaterial) {
    const [ck, tempH, tempK] = this.H.hkdf3(this.ck, inputKeyMaterial);
    this.ck.set(ck.subarray(0, this.H.hashLen));
    this.mixHash(tempH);
    const k = deriveCipherKey(tempK, this.C);
    this.cipherstate = new CipherState(this.C, k, 0n);
  }
  encryptAndHash(plaintext, out) {
    if (this.cipherstate) {
      this.cipherstate.encryptWithAd(this.h, plaintext, out);
    } else {
      out.set(plaintext);
    }
    this.mixHash(out);
  }
  decryptAndHash(data, out) {
    if (this.cipherstate) {
      this.cipherstate.decryptWithAd(this.h, data, out);
    } else {
      out.set(data);
    }
    this.mixHash(data);
  }
  split() {
    if (!this.hasKey()) {
      throw new CipherError("MissingKeyMaterial");
    }
    const [t1, t2] = this.H.hkdf(this.ck, new Uint8Array(0));
    const k1 = deriveCipherKey(t1, this.C);
    const k2 = deriveCipherKey(t2, this.C);
    return new CipherStates(new CipherState(this.C, k1, 0n), new CipherState(this.C, k2, 0n));
  }
  getHash() {
    return Uint8Array.from(this.h);
  }
  getChainingKey() {
    return Uint8Array.from(this.ck);
  }
  hasKey() {
    return this.cipherstate !== undefined;
  }
  zeroize() {
    this.h.fill(0);
    this.ck.fill(0);
    this.cipherstate = undefined;
  }
}
function concat(a, b) {
  const o = new Uint8Array(a.length + b.length);
  o.set(a, 0);
  o.set(b, a.length);
  return o;
}

// node_modules/@lukeburns/clatterjs/dist/transportState.js
function mapCipher(e) {
  if (e instanceof TransportError)
    return e;
  if (e instanceof CipherError) {
    return new TransportError("Cipher", e.message);
  }
  throw e;
}

class TransportState {
  pattern;
  cipherStates;
  h;
  initiator;
  tagLen;
  constructor(p) {
    this.pattern = p.pattern;
    this.cipherStates = p.cipherStates;
    this.h = p.handshakeHash;
    this.initiator = p.initiator;
    this.tagLen = p.tagLen;
  }
  getHandshakeHash() {
    return this.h;
  }
  getHandshakeHashValue() {
    return this.h;
  }
  send(msg, buf) {
    const t = this.tagLen;
    const n = msg.length + t;
    if (n > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (buf.length < n) {
      throw new TransportError("BufferTooSmall");
    }
    if (this.pattern.isOneWay() && !this.initiator) {
      throw new TransportError("OneWayViolation");
    }
    const c = this.outCipher();
    try {
      c.encryptWithAd(new Uint8Array(0), msg, buf.subarray(0, n));
    } catch (e) {
      throw mapCipher(e);
    }
    return n;
  }
  sendInPlace(msg, msgLen) {
    const t = this.tagLen;
    const n = msgLen + t;
    if (n > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (msg.length < n) {
      throw new TransportError("BufferTooSmall");
    }
    if (this.pattern.isOneWay() && !this.initiator) {
      throw new TransportError("OneWayViolation");
    }
    const c = this.outCipher();
    try {
      return c.encryptWithAdInPlace(new Uint8Array(0), msg, msgLen);
    } catch (e) {
      throw mapCipher(e);
    }
  }
  sendVec(msg) {
    const t = this.tagLen;
    const out = new Uint8Array(msg.length + t);
    this.send(msg, out);
    return out;
  }
  receive(msg, out) {
    const t = this.tagLen;
    if (msg.length < t) {
      throw new TransportError("TooShort");
    }
    if (msg.length > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (this.pattern.isOneWay() && this.initiator) {
      throw new TransportError("OneWayViolation");
    }
    const c = this.inCipher();
    const pLen = msg.length - t;
    if (out.length < pLen) {
      throw new TransportError("BufferTooSmall");
    }
    try {
      c.decryptWithAd(new Uint8Array(0), msg, out.subarray(0, pLen));
    } catch (e) {
      throw mapCipher(e);
    }
    return pLen;
  }
  receiveInPlace(msg, msgLen) {
    const t = this.tagLen;
    if (msgLen < t) {
      throw new TransportError("TooShort");
    }
    if (msgLen > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (msgLen > msg.length) {
      throw new TransportError("BufferTooSmall");
    }
    if (this.pattern.isOneWay() && this.initiator) {
      throw new TransportError("OneWayViolation");
    }
    const c = this.inCipher();
    try {
      return c.decryptWithAdInPlace(new Uint8Array(0), msg, msgLen);
    } catch (e) {
      throw mapCipher(e);
    }
  }
  receiveVec(msg) {
    const t = this.tagLen;
    const out = new Uint8Array(msg.length - t);
    this.receive(msg, out);
    return out;
  }
  sendingNonce() {
    return this.outCipher().getNonce();
  }
  receivingNonce() {
    return this.inCipher().getNonce();
  }
  setReceivingNonce(n) {
    this.inCipher().setNonce(n);
  }
  rekeySender() {
    try {
      this.outCipher().rekey();
    } catch (e) {
      throw mapCipher(e);
    }
  }
  rekeyReceiver() {
    try {
      this.inCipher().rekey();
    } catch (e) {
      throw mapCipher(e);
    }
  }
  takeCiphers() {
    return this.cipherStates;
  }
  outCipher() {
    return this.initiator ? this.cipherStates.initiatorToResponder : this.cipherStates.responderToInitiator;
  }
  inCipher() {
    return this.initiator ? this.cipherStates.responderToInitiator : this.cipherStates.initiatorToResponder;
  }
}
// node_modules/@noble/hashes/_u64.js
var U32_MASK642 = /* @__PURE__ */ (() => BigInt(2 ** 32 - 1))();
var _32n2 = /* @__PURE__ */ BigInt(32);
function fromBig2(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK642), l: Number(n >> _32n2 & U32_MASK642) };
  return { h: Number(n >> _32n2 & U32_MASK642) | 0, l: Number(n & U32_MASK642) | 0 };
}
function split2(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0;i < len; i++) {
    const { h, l } = fromBig2(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE ? l : h, isLE);
  view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
}
var shrSH2 = (h, _l, s) => h >>> s;
var shrSL2 = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH2 = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL2 = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH2 = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL2 = (h, l, s) => h >>> s - 32 | l << 64 - s;
var rotr32H = (_h, l) => l;
var rotr32L = (h, _l) => h;
function add2(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L2 = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H2 = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L2 = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H2 = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L2 = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H2 = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// node_modules/@noble/hashes/utils.js
function isBytes2(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function anumber2(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes2(value, length, title = "") {
  if (isBytes2(value) && (length === undefined || value.length === length))
    return value;
  if (length !== undefined)
    anumber2(length, "length");
  const bytes = isBytes2(value);
  const ofLen = length !== undefined ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function copyBytes2(bytes) {
  return Uint8Array.from(abytes2(bytes));
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber2(h.outputLen);
  anumber2(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
function aexists2(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput2(out, instance) {
  abytes2(out, undefined, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean2(...arrays) {
  for (let i = 0;i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView2(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr2(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
var swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n) >>> 0;
function byteSwap32(arr) {
  for (let i = 0;i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
var hasHexBuiltin2 = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
var hexes2 = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex2(bytes) {
  abytes2(bytes);
  if (hasHexBuiltin2)
    return bytes.toHex();
  let hex = "";
  for (let i = 0;i < bytes.length; i++) {
    hex += hexes2[bytes[i]];
  }
  return hex;
}
function asciiToBase162(ch) {
  return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - (65 - 10) : ch >= 97 && ch <= 102 ? ch - (97 - 10) : undefined;
}
function hexToBytes2(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin2) {
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0;ai < al; ai++, hi += 2) {
    const n1 = asciiToBase162(hex.charCodeAt(hi));
    const n2 = asciiToBase162(hex.charCodeAt(hi + 1));
    if (n1 === undefined || n2 === undefined) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function concatBytes2(...arrays) {
  let sum = 0;
  for (let i = 0;i < arrays.length; i++) {
    const a = arrays[i];
    abytes2(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0;i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function checkOpts(defaults, opts, title = "opts") {
  aobject(defaults, "defaults");
  if (opts !== undefined)
    aobject(opts, title);
  const merged = Object.assign(defaults, opts);
  return merged;
}
function createHasher2(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(undefined);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes4(bytesLength = 32) {
  anumber2(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/_md.js
function Chi2(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj2(a, b, c) {
  return a & b ^ a & c ^ b & c;
}

class HashMD2 {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView2(this.buffer);
  }
  update(data) {
    aexists2(this);
    abytes2(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0;pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView2(data);
        for (;blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView2(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0;i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
}
var SHA256_IV2 = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA512_IV2 = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);

class SHA2_32B extends HashMD2 {
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0;i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16;i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr2(W15, 7) ^ rotr2(W15, 18) ^ W15 >>> 3;
      const s1 = rotr2(W2, 17) ^ rotr2(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0;i < 64; i++) {
      const sigma1 = rotr2(E, 6) ^ rotr2(E, 11) ^ rotr2(E, 25);
      const T1 = H + sigma1 + Chi2(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr2(A, 2) ^ rotr2(A, 13) ^ rotr2(A, 22);
      const T2 = sigma0 + Maj2(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean2(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean2(this.buffer);
  }
}

class _SHA256 extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV2);
  }
}
var K5122 = /* @__PURE__ */ (() => split2([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh2 = /* @__PURE__ */ (() => K5122[0])();
var SHA512_Kl2 = /* @__PURE__ */ (() => K5122[1])();
var SHA512_W_H2 = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L2 = /* @__PURE__ */ new Uint32Array(80);

class SHA2_64B extends HashMD2 {
  Ah = 0;
  Al = 0;
  Bh = 0;
  Bl = 0;
  Ch = 0;
  Cl = 0;
  Dh = 0;
  Dl = 0;
  Eh = 0;
  El = 0;
  Fh = 0;
  Fl = 0;
  Gh = 0;
  Gl = 0;
  Hh = 0;
  Hl = 0;
  constructor(outputLen, IV) {
    super(128, outputLen, 16, false);
    this.Ah = IV[0] | 0;
    this.Al = IV[1] | 0;
    this.Bh = IV[2] | 0;
    this.Bl = IV[3] | 0;
    this.Ch = IV[4] | 0;
    this.Cl = IV[5] | 0;
    this.Dh = IV[6] | 0;
    this.Dl = IV[7] | 0;
    this.Eh = IV[8] | 0;
    this.El = IV[9] | 0;
    this.Fh = IV[10] | 0;
    this.Fl = IV[11] | 0;
    this.Gh = IV[12] | 0;
    this.Gl = IV[13] | 0;
    this.Hh = IV[14] | 0;
    this.Hl = IV[15] | 0;
  }
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0;i < 16; i++, offset += 4) {
      SHA512_W_H2[i] = view.getUint32(offset);
      SHA512_W_L2[i] = view.getUint32(offset += 4);
    }
    for (let i = 16;i < 80; i++) {
      const W15h = SHA512_W_H2[i - 15] | 0;
      const W15l = SHA512_W_L2[i - 15] | 0;
      const s0h = rotrSH2(W15h, W15l, 1) ^ rotrSH2(W15h, W15l, 8) ^ shrSH2(W15h, W15l, 7);
      const s0l = rotrSL2(W15h, W15l, 1) ^ rotrSL2(W15h, W15l, 8) ^ shrSL2(W15h, W15l, 7);
      const W2h = SHA512_W_H2[i - 2] | 0;
      const W2l = SHA512_W_L2[i - 2] | 0;
      const s1h = rotrSH2(W2h, W2l, 19) ^ rotrBH2(W2h, W2l, 61) ^ shrSH2(W2h, W2l, 6);
      const s1l = rotrSL2(W2h, W2l, 19) ^ rotrBL2(W2h, W2l, 61) ^ shrSL2(W2h, W2l, 6);
      const SUMl = add4L2(s0l, s1l, SHA512_W_L2[i - 7], SHA512_W_L2[i - 16]);
      const SUMh = add4H2(SUMl, s0h, s1h, SHA512_W_H2[i - 7], SHA512_W_H2[i - 16]);
      SHA512_W_H2[i] = SUMh | 0;
      SHA512_W_L2[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0;i < 80; i++) {
      const sigma1h = rotrSH2(Eh, El, 14) ^ rotrSH2(Eh, El, 18) ^ rotrBH2(Eh, El, 41);
      const sigma1l = rotrSL2(Eh, El, 14) ^ rotrSL2(Eh, El, 18) ^ rotrBL2(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L2(Hl, sigma1l, CHIl, SHA512_Kl2[i], SHA512_W_L2[i]);
      const T1h = add5H2(T1ll, Hh, sigma1h, CHIh, SHA512_Kh2[i], SHA512_W_H2[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH2(Ah, Al, 28) ^ rotrBH2(Ah, Al, 34) ^ rotrBH2(Ah, Al, 39);
      const sigma0l = rotrSL2(Ah, Al, 28) ^ rotrBL2(Ah, Al, 34) ^ rotrBL2(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add2(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L2(T1l, sigma0l, MAJl);
      Ah = add3H2(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add2(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add2(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add2(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add2(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add2(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add2(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add2(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add2(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean2(SHA512_W_H2, SHA512_W_L2);
  }
  destroy() {
    this.destroyed = true;
    clean2(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
}

class _SHA512 extends SHA2_64B {
  constructor() {
    super(64, SHA512_IV2);
  }
}
var sha256 = /* @__PURE__ */ createHasher2(() => new _SHA256, /* @__PURE__ */ oidNist(1));
var sha5122 = /* @__PURE__ */ createHasher2(() => new _SHA512, /* @__PURE__ */ oidNist(3));

// node_modules/@noble/curves/utils.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function aarray(item, title, inner = () => {}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0;i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
var abytes3 = (value, length, title) => abytes2(value, length, title);
var anumber3 = anumber2;
function aobject2(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function afunction(value, title) {
  if (typeof value !== "function")
    throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
  return value;
}
var bytesToHex3 = bytesToHex2;
var hexToBytes3 = (hex) => hexToBytes2(hex);
var isBytes3 = isBytes2;
var randomBytes5 = (bytesLength) => randomBytes4(bytesLength);
var _0n7 = /* @__PURE__ */ BigInt(0);
var _1n7 = /* @__PURE__ */ BigInt(1);
var atitle2 = (title) => title ? `"${title}" ` : "";
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle2(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig2(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber3(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function hexToNumber2(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n7 : BigInt("0x" + hex);
}
function bytesToNumberBE2(bytes) {
  return hexToNumber2(bytesToHex2(bytes));
}
function bytesToNumberLE2(bytes) {
  return hexToNumber2(bytesToHex2(copyBytes3(abytes2(bytes)).reverse()));
}
function numberToBytesBE2(n, len) {
  anumber2(len);
  if (len === 0)
    throw new Error("zero output length is invalid");
  n = abignumber(n);
  const expectedLen = len * 2;
  const hex = n.toString(16);
  if (hex.length > expectedLen)
    throw new RangeError("number is too large");
  return hexToBytes2(hex.padStart(expectedLen, "0"));
}
function numberToBytesLE2(n, len) {
  return numberToBytesBE2(n, len).reverse();
}
function copyBytes3(bytes) {
  return Uint8Array.from(abytes3(bytes));
}
function isPosBig2(n) {
  return typeof n === "bigint" && _0n7 <= n;
}
function inRange2(n, min, max) {
  return isPosBig2(n) && isPosBig2(min) && isPosBig2(max) && min <= n && n < max;
}
function aInRange2(title, n, min, max) {
  if (!inRange2(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen2(n) {
  if (n < _0n7)
    throw new Error("expected non-negative bigint, got " + n);
  return n === _0n7 ? 0 : n.toString(2).length;
}
var bitMask2 = (n) => {
  asafenumber(n, "n");
  return (_1n7 << BigInt(n)) - _1n7;
};
function validateObject2(object, fields = {}, optFields = {}, title = "object") {
  aobject2(object, title);
  aobject2(fields, "fields");
  aobject2(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
    const val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== undefined : expectedType !== "function")) {
      throw new TypeError(`${label} is invalid: expected own property`);
    }
    if (isOpt && val === undefined)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}

// node_modules/@noble/curves/abstract/modular.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n8 = /* @__PURE__ */ BigInt(0);
var _1n8 = /* @__PURE__ */ BigInt(1);
var _2n5 = /* @__PURE__ */ BigInt(2);
var _3n3 = /* @__PURE__ */ BigInt(3);
var _4n2 = /* @__PURE__ */ BigInt(4);
var _5n3 = /* @__PURE__ */ BigInt(5);
var _7n2 = /* @__PURE__ */ BigInt(7);
var _8n4 = /* @__PURE__ */ BigInt(8);
var _9n2 = /* @__PURE__ */ BigInt(9);
var _15n = /* @__PURE__ */ BigInt(15);
var _16n2 = /* @__PURE__ */ BigInt(16);
var POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
function mod2(a, b) {
  if (b <= _0n8)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n8 ? result : b + result;
}
function pow(num, power, modulo) {
  if (modulo <= _1n8)
    throw new Error("pow: expected modulus > 1, got " + modulo);
  if (typeof power !== "bigint")
    throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
  if (power < _0n8)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n8)
    return _1n8;
  if (power === _1n8)
    return num;
  let d = num % modulo;
  if (d < _0n8)
    d += modulo;
  if (power < POW_WINDOWED_MIN) {
    let p = _1n8;
    while (power > _0n8) {
      if (power & _1n8)
        p = p * d % modulo;
      d = d * d % modulo;
      power >>= _1n8;
    }
    return p;
  }
  const digits = [];
  while (power > _0n8) {
    digits.push(Number(power & _15n));
    power >>= _4n2;
  }
  const table = new Array(16);
  table[0] = _1n8;
  table[1] = d;
  for (let i = 2;i < 16; i++)
    table[i] = table[i - 1] * d % modulo;
  let p = table[digits[digits.length - 1]];
  for (let w = digits.length - 2;w >= 0; w--) {
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    const digit = digits[w];
    if (digit !== 0)
      p = p * table[digit] % modulo;
  }
  return p;
}
function pow22(x, power, modulo) {
  if (modulo <= _1n8)
    throw new Error("pow2: expected modulus > 1, got " + modulo);
  if (power < _0n8)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n8) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert2(number, modulo) {
  if (number === _0n8)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _1n8)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod2(number, modulo);
  let b = modulo;
  let x = _0n8, u = _1n8;
  while (a !== _0n8) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== _1n8)
    throw new Error("invert: does not exist");
  return mod2(x, modulo);
}
function assertIsSquare2(Fp, root, n) {
  const F = Fp;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function aoddModulus(order, fnName) {
  if ((order & _1n8) === _0n8)
    throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod42(Fp, n) {
  const F = Fp;
  const p1div4 = (F.ORDER + _1n8) / _4n2;
  const root = F.pow(n, p1div4);
  assertIsSquare2(F, root, n);
  return root;
}
function sqrt5mod82(Fp, n) {
  const F = Fp;
  const p5div8 = (F.ORDER - _5n3) / _8n4;
  const n2 = F.mul(n, _2n5);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n5), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare2(F, root, n);
  return root;
}
function sqrt9mod162(P) {
  const Fp_ = Field2(P);
  const tn = tonelliShanks2(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n2) / _16n2;
  return (Fp, n) => {
    const F = Fp;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare2(F, root, n);
    return root;
  };
}
function tonelliShanks2(P) {
  if (P < _3n3)
    throw new Error("sqrt is not defined for small field");
  aoddModulus(P, "tonelliShanks");
  let Q = P - _1n8;
  let S = 0;
  while (Q % _2n5 === _0n8) {
    Q /= _2n5;
    S++;
  }
  let Z = _2n5;
  const _Fp = Field2(P);
  while (FpLegendre2(_Fp, Z) === 1) {
    if (Z++ > 1000)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod42;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n8) / _2n5;
  return function tonelliSlow(Fp, n) {
    const F = Fp;
    if (F.is0(n))
      return n;
    if (FpLegendre2(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        throw new Error("Cannot find square root: probably non-prime P");
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n8 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt2(P) {
  aoddModulus(P, "Fp.sqrt");
  if (P % _4n2 === _3n3)
    return sqrt3mod42;
  if (P % _8n4 === _5n3)
    return sqrt5mod82;
  if (P % _16n2 === _9n2)
    return sqrt9mod162(P);
  return tonelliShanks2(P);
}
var isNegativeLE2 = (num, modulo) => (mod2(num, modulo) & _1n8) === _1n8;
var FIELD_FIELDS2 = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField2(field) {
  aobject2(field, "field");
  if (typeof field.ORDER !== "bigint")
    throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  for (const name of FIELD_FIELDS2)
    afunction(field[name], "field." + name);
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n8)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpInvertBatch2(Fp, nums, passZero = false) {
  validateField2(Fp);
  aarray(nums, "nums");
  abool(passZero, "passZero");
  const F = Fp;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : undefined);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre2(Fp, n) {
  validateField2(Fp);
  const F = Fp;
  aoddModulus(F.ORDER, "FpLegendre");
  const p1mod2 = (F.ORDER - _1n8) / _2n5;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength2(n, nBitLength) {
  if (nBitLength !== undefined)
    anumber3(nBitLength);
  if (n <= _0n8)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== undefined && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen2(n);
  if (nBitLength !== undefined && nBitLength < bits)
    throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
  const _nBitLength = nBitLength !== undefined ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = new WeakMap;

class _Field {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n8;
  ONE = _1n8;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n8)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = undefined;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength2(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod2(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n8 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n8;
  }
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n8) === _1n8;
  }
  neg(num) {
    return mod2(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod2(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod2(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod2(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod2(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return pow(num, power, this.ORDER);
  }
  div(lhs, rhs) {
    return mod2(lhs * invert2(rhs, this.ORDER), this.ORDER);
  }
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert2(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT.get(this);
    if (!sqrt)
      FIELD_SQRT.set(this, sqrt = FpSqrt2(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE2(num, this.BYTES) : numberToBytesBE2(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes3(bytes);
    const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE ? bytesToNumberLE2(bytes) : bytesToNumberBE2(bytes);
    if (modFromBytes)
      scalar = mod2(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  invertBatch(lst) {
    return FpInvertBatch2(this, lst, true);
  }
  cmov(a, b, condition) {
    abool(condition, "condition");
    return condition ? b : a;
  }
}
function Field2(ORDER, opts = {}) {
  Object.freeze(_Field.prototype);
  return new _Field(ORDER, opts);
}

// node_modules/@noble/curves/abstract/curve.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n9 = /* @__PURE__ */ BigInt(0);
var _1n9 = /* @__PURE__ */ BigInt(1);
var _4n3 = /* @__PURE__ */ BigInt(4);
var BLIND_BYTES = 16;
var BLIND_BITS = 128;
var FW_WINDOW = 5;
var TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
function validatePointCons(Point) {
  const pc = Point;
  if (typeof pc !== "function")
    throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
  afunction(pc.fromAffine, "Point.fromAffine");
  afunction(pc.fromBytes, "Point.fromBytes");
  afunction(pc.fromHex, "Point.fromHex");
  aobject2(pc.BASE, "Point.BASE");
  aobject2(pc.ZERO, "Point.ZERO");
  validateField2(pc.Fp);
  validateField2(pc.Fn);
}
function normalizeZ2(c, points) {
  validatePointCons(c);
  validateMSMPoints2(points, c);
  const invertedZs = FpInvertBatch2(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW2(W, bits, min = 1) {
  if (!Number.isSafeInteger(W) || W < min || W > bits)
    throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes(numPoints, fpBytes) {
  const bytes = numPoints * (4 * fpBytes + 128);
  if (bytes > TABLE_BYTES_MAX)
    throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
}
function probeRandomBytes(randomBytes, length) {
  if (randomBytes === undefined)
    return;
  afunction(randomBytes, "randomBytes");
  try {
    const probe = randomBytes(length);
    if (!isBytes3(probe) || probe.length !== length)
      return;
  } catch {
    return;
  }
  return randomBytes;
}
function validateMSMPoints2(points, c) {
  aarray(points, "points");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars2(scalars, field, maxScalar) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    const ok = maxScalar === undefined ? field.isValid(s) : isPosBig2(s) && s < maxScalar;
    if (!ok)
      throw new Error("invalid scalar at index " + i);
  });
}
var pointWindowSizes2 = new WeakMap;
function getWindowSize(P) {
  return pointWindowSizes2.get(P) || 1;
}
function oddMultiples(p, size) {
  const dbl = p.double();
  const t = [p];
  for (let j = 1;j < size; j++)
    t.push(t[j - 1].add(dbl));
  return t;
}
function wnafDigits(n, W) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const d = [];
  while (n > _0n9) {
    let w = 0;
    if (n & _1n9) {
      w = Number(n & mask);
      if (w >= half)
        w -= size;
      n -= BigInt(w);
    }
    d.push(w);
    n >>= _1n9;
  }
  return d;
}
function signedWindowDigits(n, W, windows) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const shiftBy = BigInt(W);
  const d = [];
  for (let w = 0;w < windows; w++) {
    let v = Number(n & mask);
    n >>= shiftBy;
    if (v > half) {
      v -= size;
      n += _1n9;
    }
    d.push(v);
  }
  if (n !== _0n9)
    throw new Error("invalid wnaf");
  return d;
}
function wnafWalk(zero, tables, digits) {
  let max = 0;
  for (const d of digits)
    max = Math.max(max, d.length);
  let acc = zero;
  for (let bit = max - 1;bit >= 0; bit--) {
    if (bit !== max - 1)
      acc = acc.double();
    for (let i = 0;i < digits.length; i++) {
      const w = digits[i][bit];
      if (w) {
        const item = tables[i][Math.abs(w) - 1 >> 1];
        acc = acc.add(w < 0 ? item.negate() : item);
      }
    }
  }
  return acc;
}

class ScalarMultiplier {
  Point;
  BASE;
  ZERO;
  randomBytes;
  wnafPrecomputes = new WeakMap;
  baseCanBeBlinded;
  bits;
  constructor(Point, randomBytes) {
    validatePointCons(Point);
    this.randomBytes = probeRandomBytes(randomBytes, BLIND_BYTES);
    this.Point = Point;
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.bits = Point.Fn.BITS;
  }
  buildWnafTable(point, W, bits) {
    const windows = Math.ceil(bits / W) + 1;
    const half = 2 ** (W - 1);
    const comp = [];
    let base = point;
    for (let w = 0;w < windows; w++) {
      let acc = base;
      for (let i = 0;i < half; i++) {
        comp.push(acc);
        acc = acc.add(base);
      }
      base = comp[comp.length - 1].double();
    }
    return { W, bits, windows, comp };
  }
  wnafCachedCT(precomputes, n) {
    const { W, windows, comp } = precomputes;
    const half = 2 ** (W - 1);
    const digits = signedWindowDigits(n, W, windows);
    let p = this.ZERO;
    let f = this.BASE;
    for (let w = 0;w < windows; w++) {
      const digit = digits[w];
      const start = w * half;
      const idx = Math.abs(digit) - 1;
      let sel = comp[start];
      for (let i = 1;i < half; i++)
        sel = i === idx ? comp[start + i] : sel;
      const neg = sel.negate();
      if (digit === 0)
        f = f.add(comp[start]);
      else
        p = p.add(digit < 0 ? neg : sel);
    }
    return { p, f };
  }
  getWnafPrecomputes(W, point, bits, transform) {
    let entries = this.wnafPrecomputes.get(point);
    let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
    if (!comp) {
      comp = this.buildWnafTable(point, W, bits);
      if (typeof transform === "function")
        comp = { ...comp, comp: transform(comp.comp) };
      if (!entries) {
        entries = [];
        this.wnafPrecomputes.set(point, entries);
      }
      entries.push(comp);
    }
    return comp;
  }
  assertPoint(point) {
    if (!(point instanceof this.Point))
      throw new TypeError('"point" expected Point instance, got type=' + typeof point);
  }
  validateMulInput(point, scalar) {
    this.assertPoint(point);
    if (!inRange2(scalar, _1n9, this.Point.Fn.ORDER))
      throw new Error("invalid scalar");
  }
  runCT(point, n, bits, transform) {
    const W = getWindowSize(point);
    if (W === 1)
      return this.fixedWindowCT(point, n, bits);
    return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
  }
  mulCT(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    return this.runCT(point, scalar, this.bits, transform);
  }
  mulCTBlinded(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    if (this.randomBytes === undefined)
      throw new Error("randomBytes is required for scalar blinding");
    const bits = this.Point.Fn.BITS + BLIND_BITS;
    const blind = this.randomBytes(BLIND_BYTES);
    if (!isBytes3(blind) || blind.length !== BLIND_BYTES)
      throw new Error("randomBytes returned invalid byte array");
    blind[0] = blind[0] & 63 | 128;
    const n = scalar + bytesToNumberBE2(blind) * this.Point.Fn.ORDER;
    return this.runCT(point, n, bits, transform);
  }
  fixedWindowCT(point, n, bits) {
    const W = FW_WINDOW;
    const size = 1 << W;
    const mask = bitMask2(W);
    const table = new Array(size);
    table[0] = this.ZERO;
    for (let i = 1;i < size; i++)
      table[i] = table[i - 1].add(point);
    const windows = Math.ceil(bits / W);
    let acc = this.ZERO;
    for (let window = windows - 1;window >= 0; window--) {
      if (window !== windows - 1)
        for (let d = 0;d < W; d++)
          acc = acc.double();
      const digit = Number(n >> BigInt(window * W) & mask);
      let sel = table[0];
      for (let i = 1;i < size; i++)
        sel = i === digit ? table[i] : sel;
      acc = acc.add(sel);
    }
    return { p: acc, f: acc };
  }
  shouldBlind(point, cofactor) {
    if (this.randomBytes === undefined)
      return false;
    if (cofactor === _1n9)
      return true;
    if (point !== this.BASE)
      return false;
    if (this.baseCanBeBlinded === undefined)
      this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
    return this.baseCanBeBlinded;
  }
  mulSecret(point, scalar, cofactor, transform) {
    return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
  }
  mulUnsafe(point, scalar, transform) {
    this.assertPoint(point);
    if (!isPosBig2(scalar))
      throw new Error("invalid scalar");
    const W = getWindowSize(point);
    if (W === 1 || scalar >= this.Point.Fn.ORDER)
      return mulAddUnsafe(this.Point, [point], [scalar], true);
    const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
    return this.wnafCachedCT(precomputes, scalar).p;
  }
  setWindowSize(point, W) {
    this.assertPoint(point);
    validateW2(W, this.bits);
    const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
    validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
    pointWindowSizes2.set(point, W);
    this.wnafPrecomputes.delete(point);
  }
  hasWindowSize(point) {
    return getWindowSize(point) !== 1;
  }
}
function mulAddUnsafe(c, points, scalars, allowOversized = false) {
  validatePointCons(c);
  validateMSMPoints2(points, c);
  abool(allowOversized, "allowOversized");
  validateMSMScalars2(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n3 : undefined);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const tables = points.map((p) => oddMultiples(p, 4));
  const digits = scalars.map((n) => wnafDigits(n, 4));
  return wnafWalk(c.ZERO, tables, digits);
}
function createField2(order, field, isLE) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField2(field);
    return field;
  } else {
    return Field2(order, { isLE });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (type !== "weierstrass" && type !== "edwards")
    throw new Error('expected curve type "weierstrass" or "edwards"');
  if (FpFnLE === undefined)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  validateObject2(curveOpts);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(isPosBig2(val) && val !== _0n9))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField2(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField2(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// node_modules/@noble/curves/abstract/edwards.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n10 = /* @__PURE__ */ BigInt(0);
var _1n10 = /* @__PURE__ */ BigInt(1);
var _2n6 = /* @__PURE__ */ BigInt(2);
var _4n4 = /* @__PURE__ */ BigInt(4);
var _8n5 = /* @__PURE__ */ BigInt(8);
function isEdValidXY2(Fp, CURVE, x, y) {
  const x2 = Fp.sqr(x);
  const y2 = Fp.sqr(y);
  const left = Fp.add(Fp.mul(CURVE.a, x2), y2);
  const right = Fp.add(Fp.ONE, Fp.mul(CURVE.d, Fp.mul(x2, y2)));
  return Fp.eql(left, right);
}
function edwards2(params, extraOpts = {}) {
  validateObject2(extraOpts, {}, {}, "extraOpts");
  const opts = extraOpts;
  const validated = createCurveFields("edwards", params, opts, opts.FpFnLE);
  const { Fp, Fn } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  if (FpLegendre2(Fp, CURVE.a) !== 1)
    throw new Error("edwards: CURVE.a must be a square in Fp for complete addition formulas");
  if (FpLegendre2(Fp, CURVE.d) !== -1)
    throw new Error("edwards: CURVE.d must be a non-square in Fp for complete addition formulas");
  validateObject2(opts, {}, { uvRatio: "function", randomBytes: "function" });
  const randomBytes = opts.randomBytes === undefined ? randomBytes5 : opts.randomBytes;
  const MASK = _2n6 << BigInt(Fp.BYTES * 8) - _1n10;
  function isOdd(n) {
    if (!Fp.isOdd)
      throw new Error("Field does not have .isOdd()");
    return Fp.isOdd(n);
  }
  const uvRatio = opts.uvRatio === undefined ? (u, v) => {
    try {
      return { isValid: true, value: Fp.sqrt(Fp.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n10 };
    }
  } : opts.uvRatio;
  if (!isEdValidXY2(Fp, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const mulA = Fp.eql(CURVE.a, Fp.neg(Fp.ONE)) ? (x) => Fp.neg(x) : Fp.eql(CURVE.a, Fp.ONE) ? (x) => x : (x) => Fp.mul(CURVE.a, x);
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n10 : _0n10;
    aInRange2("coordinate " + title, n, min, MASK);
    return n;
  }
  function aedpoint(other) {
    if (!(other instanceof Point))
      throw new Error("EdwardsPoint expected");
  }

  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE, Fp.mul(CURVE.Gx, CURVE.Gy));
    static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ONE, Fp.ZERO);
    static Fp = Fp;
    static Fn = Fn;
    X;
    Y;
    Z;
    T;
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point(x, y, Fp.ONE, Fp.mul(x, y));
    }
    static fromBytes(bytes, zip215 = false) {
      const len = Fp.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes3(abytes3(bytes, len, "point"));
      abool(zip215, "zip215");
      const normed = copyBytes3(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE2(normed);
      const max = zip215 ? MASK : Fp.ORDER;
      aInRange2("point.y", y, _0n10, max);
      const y2 = Fp.sqr(y);
      const u = Fp.sub(y2, Fp.ONE);
      const v = Fp.sub(Fp.mulN(d, y2), a);
      let { isValid, value: x } = uvRatio(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = isOdd(x);
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && Fp.is0(x) && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = Fp.neg(x);
      return Point.fromAffine({ x, y });
    }
    static fromHex(hex, zip215 = false) {
      return Point.fromBytes(hexToBytes3(hex), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_2n6);
      return this;
    }
    assertValidity() {
      const p = this;
      const { a, d } = CURVE;
      if (p.is0())
        throw new Error("bad point: ZERO");
      const { X, Y, Z, T } = p;
      const X2 = Fp.sqr(X);
      const Y2 = Fp.sqr(Y);
      const Z2 = Fp.sqr(Z);
      const Z4 = Fp.sqr(Z2);
      const aX2 = Fp.mul(X2, a);
      const left = Fp.mul(Fp.add(aX2, Y2), Z2);
      const right = Fp.add(Z4, Fp.mul(d, Fp.mul(X2, Y2)));
      if (!Fp.eql(left, right))
        throw new Error("bad point: equation left != right (1)");
      const XY = Fp.mul(X, Y);
      const ZT = Fp.mul(Z, T);
      if (!Fp.eql(XY, ZT))
        throw new Error("bad point: equation left != right (2)");
    }
    equals(other) {
      aedpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = Fp.mul(X1, Z2);
      const X2Z1 = Fp.mul(X2, Z1);
      const Y1Z2 = Fp.mul(Y1, Z2);
      const Y2Z1 = Fp.mul(Y2, Z1);
      return Fp.eql(X1Z2, X2Z1) && Fp.eql(Y1Z2, Y2Z1);
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(Fp.neg(this.X), this.Y, this.Z, Fp.neg(this.T));
    }
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = Fp.sqr(X1);
      const B = Fp.sqr(Y1);
      const C = Fp.mul(Fp.sqr(Z1), _2n6);
      const D = mulA(A);
      const x1y1 = Fp.addN(X1, Y1);
      const E = Fp.sub(Fp.subN(Fp.sqr(x1y1), A), B);
      const G = Fp.addN(D, B);
      const F = Fp.subN(G, C);
      const H = Fp.subN(D, B);
      const X3 = Fp.mul(E, F);
      const Y3 = Fp.mul(G, H);
      const T3 = Fp.mul(E, H);
      const Z3 = Fp.mul(F, G);
      return new Point(X3, Y3, Z3, T3);
    }
    add(other) {
      aedpoint(other);
      const { d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = Fp.mul(X1, X2);
      const B = Fp.mul(Y1, Y2);
      const C = Fp.mul(Fp.mulN(T1, d), T2);
      const D = Fp.mul(Z1, Z2);
      const E = Fp.sub(Fp.subN(Fp.mulN(Fp.addN(X1, Y1), Fp.addN(X2, Y2)), A), B);
      const F = Fp.subN(D, C);
      const G = Fp.addN(D, C);
      const H = Fp.sub(B, mulA(A));
      const X3 = Fp.mul(E, F);
      const Y3 = Fp.mul(G, H);
      const T3 = Fp.mul(E, H);
      const Z3 = Fp.mul(F, G);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      aedpoint(other);
      return this.add(other.negate());
    }
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    multiplyUnsafe(scalar) {
      if (!Fn.isValid(scalar))
        throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n10)
        return Point.ZERO;
      if (this.is0() || scalar === _1n10)
        return this;
      return wnaf.mulUnsafe(this, scalar, normalize);
    }
    isSmallOrder() {
      return this.clearCofactor().is0();
    }
    isTorsionFree() {
      return wnaf.mulUnsafe(this, CURVE.n).is0();
    }
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && typeof iz !== "bigint")
        throw new TypeError('"invertedZ" expected bigint, got type=' + typeof iz);
      const { X, Y, Z } = p;
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.create(_8n5) : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ONE };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    clearCofactor() {
      if (cofactor === _1n10)
        return this;
      if (cofactor === _2n6)
        return this.double();
      if (cofactor === _4n4)
        return this.double().double();
      if (cofactor === _8n5)
        return this.double().double().double();
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp.toBytes(y);
      bytes[bytes.length - 1] |= isOdd(x) ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex3(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const normalize = (points) => normalizeZ2(Point, points);
  const wnaf = new ScalarMultiplier(Point, randomBytes);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}

// node_modules/@noble/curves/abstract/montgomery.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n11 = /* @__PURE__ */ BigInt(0);
var _1n11 = /* @__PURE__ */ BigInt(1);
var _2n7 = /* @__PURE__ */ BigInt(2);
function cmask(P, swap) {
  return P + swap - (swap >> _1n11 << _1n11);
}
function cswap(P) {
  const offset = BigInt(6) * P;
  return (mask, x_2, x_3) => {
    const sum = x_2 + x_3;
    const d = offset + x_3 - x_2;
    const a = (d * mask + x_2) % P;
    return { x_2: a, x_3: sum - a };
  };
}
function validateOpts2(curve) {
  validateObject2(curve, {
    P: "bigint",
    type: "string",
    adjustScalarBytes: "function",
    powPminus2: "function"
  }, {
    randomBytes: "function",
    scalarMultBase: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery2(curveDef) {
  const CURVE = validateOpts2(curveDef);
  const { P, type, adjustScalarBytes, powPminus2, randomBytes: rand } = CURVE;
  const mulBaseHook = CURVE.scalarMultBase;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand === undefined ? randomBytes5 : rand;
  const montgomeryBits = is25519 ? 255 : 448;
  const swap = cswap(P);
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n7 ** BigInt(254) : _2n7 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * (_2n7 ** BigInt(251) - _1n11) : BigInt(4) * (_2n7 ** BigInt(445) - _1n11);
  const maxScalar = minScalar + maxAdded + _1n11;
  const modP = (n) => mod2(n, P);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE2(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = copyBytes3(abytes3(u, fieldLen, "uCoordinate"));
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE2(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE2(adjustScalarBytes(copyBytes3(abytes3(scalar, fieldLen, "scalar"))));
  }
  const lowOrderU = new Set(is25519 ? [
    _0n11,
    _1n11,
    P - _1n11,
    BigInt("325606250916557431795983626356110631294008115727848805560023387167927233504"),
    BigInt("39382357235489614581723060781553021112529911719440698176882885853963445705823")
  ] : [_0n11, _1n11, P - _1n11]);
  function scalarMult(scalar, u) {
    const pointU = decodeU(u);
    if (lowOrderU.has(pointU))
      throw new Error("invalid private or public key received");
    const pu = montgomeryLadder(pointU, decodeScalar(scalar));
    if (pu === _0n11)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    if (mulBaseHook === undefined)
      return scalarMult(scalar, GuBytes);
    const k = decodeScalar(scalar);
    aInRange2("scalar", k, minScalar, maxScalar);
    const pu = modP(mulBaseHook(k));
    if (pu === _0n11)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  const getPublicKey = scalarMultBase;
  const getSharedSecret = scalarMult;
  function montgomeryLadder(u, scalar) {
    aInRange2("u", u, _0n11, P);
    aInRange2("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n11;
    let z_2 = _0n11;
    let x_3 = u;
    let z_3 = _1n11;
    const kx = k ^ k >> _1n11;
    for (let t = BigInt(montgomeryBits - 1);t >= _0n11; t--) {
      const mask = cmask(P, kx >> t);
      ({ x_2, x_3 } = swap(mask, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    const mask = cmask(P, k);
    ({ x_2, x_3 } = swap(mask, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey = (seed) => {
    seed = seed === undefined ? randomBytes_(fieldLen) : seed;
    abytes3(seed, lengths.seed, "seed");
    return seed;
  };
  const utils = { randomSecretKey };
  Object.freeze(lengths);
  Object.freeze(utils);
  return Object.freeze({
    keygen: createKeygen(randomSecretKey, getPublicKey),
    getSharedSecret,
    getPublicKey,
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  });
}

// node_modules/@noble/curves/ed25519.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n12 = /* @__PURE__ */ BigInt(0);
var _1n12 = /* @__PURE__ */ BigInt(1);
var _2n8 = /* @__PURE__ */ BigInt(2);
var _3n4 = /* @__PURE__ */ BigInt(3);
var _5n4 = /* @__PURE__ */ BigInt(5);
var _8n6 = /* @__PURE__ */ BigInt(8);
var ed25519_CURVE_p2 = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE2 = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p2,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n6,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_32(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ed25519_CURVE_p2;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow22(b2, _2n8, P) * b2 % P;
  const b5 = pow22(b4, _1n12, P) * x % P;
  const b10 = pow22(b5, _5n4, P) * b5 % P;
  const b20 = pow22(b10, _10n, P) * b10 % P;
  const b40 = pow22(b20, _20n, P) * b20 % P;
  const b80 = pow22(b40, _40n, P) * b40 % P;
  const b160 = pow22(b80, _80n, P) * b80 % P;
  const b240 = pow22(b160, _80n, P) * b80 % P;
  const b250 = pow22(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow22(b250, _2n8, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes2(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M12 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio2(u, v) {
  const P = ed25519_CURVE_p2;
  const v3 = mod2(v * v * v, P);
  const v7 = mod2(v3 * v3 * v, P);
  const pow = ed25519_pow_2_252_32(u * v7).pow_p_5_8;
  let x = mod2(u * v3 * pow, P);
  const vx2 = mod2(v * x * x, P);
  const root1 = x;
  const root2 = mod2(x * ED25519_SQRT_M12, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod2(-u, P);
  const noRoot = vx2 === mod2(-u * ED25519_SQRT_M12, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE2(x, P))
    x = mod2(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var ed25519_Point = /* @__PURE__ */ edwards2(ed25519_CURVE2, { uvRatio: uvRatio2 });
var x255192 = /* @__PURE__ */ (() => {
  const P = ed25519_CURVE_p2;
  const powPminus2 = (x) => {
    const { pow_p_5_8, b2 } = ed25519_pow_2_252_32(x);
    return mod2(pow22(pow_p_5_8, _3n4, P) * b2, P);
  };
  return montgomery2({
    P,
    type: "x25519",
    powPminus2,
    adjustScalarBytes: adjustScalarBytes2,
    scalarMultBase: (k) => {
      const kn = mod2(k, ed25519_Point.Fn.ORDER);
      if (kn === _0n12)
        return _0n12;
      const p = ed25519_Point.BASE.multiply(kn);
      return mod2((p.Z + p.Y) * powPminus2(mod2(p.Z - p.Y, P)), P);
    }
  });
})();

// node_modules/@lukeburns/clatterjs/dist/dhX25519.js
var PK = 32;
var X25519_NAME = "25519";
function x25519Keygen(rng) {
  const sk = rng(32);
  return { secretKey: sk, publicKey: x255192.getPublicKey(sk) };
}
function x25519Dh(ourSec, theirPub) {
  return x255192.getSharedSecret(ourSec, theirPub);
}
function dhPubKeyLen() {
  return PK;
}

// node_modules/@lukeburns/clatterjs/dist/protocolNames.js
function nqProtocolName(patternName, cipher, hash) {
  return `Noise_${patternName}_${X25519_NAME}_${cipher.name}_${hash.name}`;
}

// node_modules/@lukeburns/clatterjs/dist/nqHandshake.js
var PK2 = () => dhPubKeyLen();

class NqHandshake {
  pattern;
  config;
  symmetric;
  s;
  e;
  rs;
  re;
  status;
  initiatorPatternIndex = 0;
  responderPatternIndex = 0;
  psks = [];
  pskApplied = false;
  ownRandomnessApplied = false;
  constructor(pattern, config) {
    this.pattern = pattern;
    this.config = config;
    if (pattern.getType() !== 0) {
      throw new HandshakeError("InvalidPattern");
    }
    const name = nqProtocolName(pattern.getName(), config.cipher, config.hash);
    this.symmetric = new SymmetricState(config.cipher, config.hash, name);
    this.symmetric.mixHash(config.prologue);
    const I = config.initiator;
    for (const t of pattern.getInitiatorPreShared()) {
      if (t === 1) {
        this.symmetric.mixHash((I ? config.s?.publicKey : config.rs) ?? raiseMissing());
      } else {
        throw new Error("Invalid pre-shared token in pattern");
      }
    }
    for (const t of pattern.getResponderPreShared()) {
      if (t === 1) {
        this.symmetric.mixHash((I ? config.rs : config.s?.publicKey) ?? raiseMissing());
      } else if (t === 0) {
        if (I) {
          const reB = config.re ?? raiseMissing();
          this.symmetric.mixHash(reB);
          if (pattern.hasPsk()) {
            this.symmetric.mixKey(reB);
          }
        } else {
          const eB = config.e?.publicKey ?? raiseMissing();
          this.symmetric.mixHash(eB);
          if (pattern.hasPsk()) {
            this.symmetric.mixKey(eB);
          }
        }
      } else {
        throw new Error("Invalid pre-shared token in pattern");
      }
    }
    this.s = config.s;
    this.e = config.e;
    this.rs = config.rs;
    this.re = config.re;
    this.status = config.initiator ? 0 : 1;
  }
  getPattern() {
    return this.pattern;
  }
  isInitiator() {
    return this.config.initiator;
  }
  isWriteTurn() {
    return this.status === 0;
  }
  isFinished() {
    return this.status === 2;
  }
  mixHash(data) {
    this.symmetric.mixHash(data);
  }
  mixKeyAndHash(data) {
    this.symmetric.mixKeyAndHash(data);
  }
  pushPsk(psk) {
    if (psk.length !== PSK_LEN) {
      throw new Error(`PSK must be ${PSK_LEN} bytes`);
    }
    if (this.psks.length >= MAX_PSKS) {
      throw new Error("PSK queue full");
    }
    this.psks.push(Uint8Array.from(psk));
  }
  getName() {
    return nqProtocolName(this.pattern.getName(), this.config.cipher, this.config.hash);
  }
  getHash() {
    return this.symmetric.getHash();
  }
  getRemoteStatic() {
    return this.rs ? Uint8Array.from(this.rs) : undefined;
  }
  getRemoteEphemeral() {
    return this.re ? Uint8Array.from(this.re) : undefined;
  }
  getCiphers() {
    try {
      return this.symmetric.split();
    } catch (e) {
      if (e instanceof CipherError) {
        throw new HandshakeError("Cipher", undefined, e);
      }
      throw e;
    }
  }
  finalize() {
    if (!this.isFinished()) {
      throw new HandshakeError("InvalidState");
    }
    return new TransportState({
      pattern: this.pattern,
      cipherStates: this.getCiphers(),
      handshakeHash: this.getHash(),
      initiator: this.isInitiator(),
      tagLen: this.config.cipher.tagLen
    });
  }
  nextTokensForCurrentTurn() {
    const a = this.config.initiator;
    const st = this.status;
    if (st === 3 || st === 2) {
      throw new HandshakeError("InvalidState");
    }
    if (a && st === 0 || !a && st === 1) {
      return this.pattern.getInitiatorPattern(this.initiatorPatternIndex) ?? raiseInv();
    }
    return this.pattern.getResponderPattern(this.responderPatternIndex) ?? raiseInv();
  }
  getNextMessageOverhead() {
    const message = this.nextTokensForCurrentTurn();
    let overhead = 0;
    let hasKey = this.symmetric.hasKey();
    const hasPsk = this.pattern.hasPsk();
    const { cipher: C } = this.config;
    const pkl = PK2();
    for (const token of message) {
      if (token === 0) {
        overhead += pkl;
        if (hasPsk) {
          hasKey = true;
        }
      } else if (token === 1) {
        overhead += pkl;
        if (hasKey) {
          overhead += C.tagLen;
        }
      } else if (token === 2 || token === 3 || token === 4 || token === 5) {
        hasKey = true;
      } else if (token === 8) {} else {
        throw new Error("Incompatible pattern");
      }
    }
    if (hasKey) {
      overhead += C.tagLen;
    }
    return overhead;
  }
  writeMessage(payload, out) {
    if (this.status === 3) {
      throw new HandshakeError("ErrorState");
    }
    if (!this.isWriteTurn()) {
      throw new HandshakeError("InvalidState");
    }
    const oh = this.getNextMessageOverhead();
    const outLen = payload.length + oh;
    if (outLen > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (out.length < outLen) {
      throw new HandshakeError("BufferTooSmall");
    }
    try {
      return this.writeMessageImpl(payload, out, outLen);
    } catch (e) {
      this.setError();
      throw e;
    }
  }
  readMessage(message, out) {
    if (message.length > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (this.status === 3) {
      throw new HandshakeError("ErrorState");
    }
    if (this.isWriteTurn()) {
      throw new HandshakeError("InvalidState");
    }
    const oh = this.getNextMessageOverhead();
    if (message.length < oh) {
      throw new HandshakeError("InvalidMessage");
    }
    const outLen = message.length - oh;
    if (out.length < outLen) {
      throw new HandshakeError("BufferTooSmall");
    }
    try {
      return this.readMessageImpl(message, out, outLen);
    } catch (e) {
      this.setError();
      throw e;
    }
  }
  setError() {
    this.status = 3;
    this.symmetric.zeroize();
  }
  pskValidityCheck() {
    if (this.pskApplied && !this.ownRandomnessApplied) {
      throw new HandshakeError("Pattern", "PskValidityViolation", new PatternError("PskValidityViolation"));
    }
  }
  takePsk() {
    const p = this.psks.shift();
    if (!p) {
      throw new HandshakeError("PskMissing");
    }
    this.pskApplied = true;
    return p;
  }
  mapDh(t) {
    const needS = (kp) => {
      if (!kp) {
        throw new HandshakeError("MissingMaterial");
      }
      return kp;
    };
    const needB = (b) => {
      if (!b) {
        throw new HandshakeError("MissingMaterial");
      }
      return b;
    };
    let ss;
    try {
      if (t === 2) {
        ss = x25519Dh(needS(this.e).secretKey, needB(this.re));
      } else if (t === 3) {
        if (this.isInitiator()) {
          ss = x25519Dh(needS(this.e).secretKey, needB(this.rs));
        } else {
          ss = x25519Dh(needS(this.s).secretKey, needB(this.re));
        }
      } else if (t === 4) {
        if (this.isInitiator()) {
          ss = x25519Dh(needS(this.s).secretKey, needB(this.re));
        } else {
          ss = x25519Dh(needS(this.e).secretKey, needB(this.rs));
        }
      } else if (t === 5) {
        ss = x25519Dh(needS(this.s).secretKey, needB(this.rs));
      } else {
        throw new Error("mapDh");
      }
    } catch (e) {
      if (e instanceof HandshakeError) {
        throw e;
      }
      throw new HandshakeError("Dh", e instanceof Error ? e.message : String(e));
    }
    if (ss.length !== 32) {
      throw new HandshakeError("Dh", "Invalid shared secret length");
    }
    return ss;
  }
  updateHsStatus() {
    if (this.initiatorPatternIndex === this.pattern.getInitiatorPatternLen() && this.responderPatternIndex === this.pattern.getResponderPatternLen()) {
      this.status = 2;
    } else if (this.status === 1) {
      this.status = 0;
    } else {
      this.status = 1;
    }
  }
  writeMessageImpl(payload, out, outLen) {
    const message = this.isInitiator() ? this.pattern.getInitiatorPattern(this.initiatorPatternIndex++) : this.pattern.getResponderPattern(this.responderPatternIndex++);
    if (!message) {
      throw new HandshakeError("InvalidState");
    }
    const { cipher: C, rng } = this.config;
    const pkl = PK2();
    let cur = 0;
    for (const token of message) {
      if (token === 0) {
        if (!this.e) {
          this.e = x25519Keygen(rng);
        }
        const ePub = this.e.publicKey;
        this.symmetric.mixHash(ePub);
        if (this.pattern.hasPsk()) {
          this.symmetric.mixKey(ePub);
        }
        out.set(ePub, cur);
        cur += pkl;
        this.ownRandomnessApplied = true;
      } else if (token === 1) {
        if (!this.s) {
          throw new HandshakeError("MissingMaterial");
        }
        this.pskValidityCheck();
        const len = this.symmetric.hasKey() ? pkl + C.tagLen : pkl;
        this.symmetric.encryptAndHash(this.s.publicKey, out.subarray(cur, cur + len));
        cur += len;
      } else if (token === 8) {
        this.symmetric.mixKeyAndHash(this.takePsk());
      } else if (token === 2 || token === 3 || token === 4 || token === 5) {
        this.symmetric.mixKey(this.mapDh(token));
      } else {
        throw new Error("Incompatible pattern");
      }
    }
    if (payload.length > 0 && this.pskApplied && !this.ownRandomnessApplied) {
      throw new HandshakeError("Pattern", "PskValidityViolation", new PatternError("PskValidityViolation"));
    }
    this.symmetric.encryptAndHash(payload, out.subarray(cur, outLen));
    this.updateHsStatus();
    return outLen;
  }
  readMessageImpl(message, out, outLen) {
    let rest = message;
    const take = (n) => {
      if (rest.length < n) {
        throw new HandshakeError("InvalidMessage");
      }
      const s = rest.subarray(0, n);
      rest = rest.subarray(n);
      return s;
    };
    const pat = this.isInitiator() ? this.pattern.getResponderPattern(this.responderPatternIndex++) : this.pattern.getInitiatorPattern(this.initiatorPatternIndex++);
    if (!pat) {
      throw new HandshakeError("InvalidState");
    }
    const { cipher: C } = this.config;
    const pkl = PK2();
    for (const token of pat) {
      if (token === 0) {
        const re = Uint8Array.from(take(pkl));
        this.symmetric.mixHash(re);
        if (this.pattern.hasPsk()) {
          this.symmetric.mixKey(re);
        }
        this.re = re;
      } else if (token === 1) {
        const len = this.symmetric.hasKey() ? pkl + C.tagLen : pkl;
        const bu = new Uint8Array(pkl);
        this.symmetric.decryptAndHash(take(len), bu);
        this.rs = bu;
      } else if (token === 8) {
        this.symmetric.mixKeyAndHash(this.takePsk());
      } else if (token === 2 || token === 3 || token === 4 || token === 5) {
        this.symmetric.mixKey(this.mapDh(token));
      } else {
        throw new Error("Incompatible pattern");
      }
    }
    this.symmetric.decryptAndHash(rest, out.subarray(0, outLen));
    this.updateHsStatus();
    return outLen;
  }
}
function raiseMissing() {
  throw new HandshakeError("MissingMaterial");
}
function raiseInv() {
  throw new HandshakeError("InvalidState");
}
// node_modules/@noble/hashes/_blake.js
var BSIGMA = /* @__PURE__ */ Uint8Array.from([
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9,
  12,
  5,
  1,
  15,
  14,
  13,
  4,
  10,
  0,
  7,
  6,
  3,
  9,
  2,
  8,
  11,
  13,
  11,
  7,
  14,
  12,
  1,
  3,
  9,
  5,
  0,
  15,
  4,
  8,
  6,
  2,
  10,
  6,
  15,
  14,
  9,
  11,
  3,
  0,
  8,
  12,
  2,
  13,
  7,
  1,
  4,
  10,
  5,
  10,
  2,
  8,
  4,
  7,
  6,
  1,
  5,
  15,
  11,
  9,
  14,
  3,
  12,
  13,
  0,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9
]);
function G1s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr2(d ^ a, 16);
  c = c + d | 0;
  b = rotr2(b ^ c, 12);
  return { a, b, c, d };
}
function G2s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr2(d ^ a, 8);
  c = c + d | 0;
  b = rotr2(b ^ c, 7);
  return { a, b, c, d };
}

// node_modules/@noble/hashes/blake2.js
var B2B_IV = /* @__PURE__ */ Uint32Array.from([
  4089235720,
  1779033703,
  2227873595,
  3144134277,
  4271175723,
  1013904242,
  1595750129,
  2773480762,
  2917565137,
  1359893119,
  725511199,
  2600822924,
  4215389547,
  528734635,
  327033209,
  1541459225
]);
var BBUF = /* @__PURE__ */ new Uint32Array(32);
function G1b(a, b, c, d, msg, x) {
  const Xl = msg[x], Xh = msg[x + 1];
  let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
  let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
  let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
  let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
  const ll = add3L2(Al, Bl, Xl);
  Ah = add3H2(ll, Ah, Bh, Xh);
  Al = ll | 0;
  let xh = Dh ^ Ah, xl = Dl ^ Al;
  Dh = rotr32H(xh, xl);
  Dl = rotr32L(xh, xl);
  ({ h: Ch, l: Cl } = add2(Ch, Cl, Dh, Dl));
  xh = Bh ^ Ch;
  xl = Bl ^ Cl;
  Bh = rotrSH2(xh, xl, 24);
  Bl = rotrSL2(xh, xl, 24);
  BBUF[2 * a] = Al;
  BBUF[2 * a + 1] = Ah;
  BBUF[2 * b] = Bl;
  BBUF[2 * b + 1] = Bh;
  BBUF[2 * c] = Cl;
  BBUF[2 * c + 1] = Ch;
  BBUF[2 * d] = Dl;
  BBUF[2 * d + 1] = Dh;
}
function G2b(a, b, c, d, msg, x) {
  const Xl = msg[x], Xh = msg[x + 1];
  let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
  let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
  let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
  let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
  const ll = add3L2(Al, Bl, Xl);
  Ah = add3H2(ll, Ah, Bh, Xh);
  Al = ll | 0;
  let xh = Dh ^ Ah, xl = Dl ^ Al;
  Dh = rotrSH2(xh, xl, 16);
  Dl = rotrSL2(xh, xl, 16);
  ({ h: Ch, l: Cl } = add2(Ch, Cl, Dh, Dl));
  xh = Bh ^ Ch;
  xl = Bl ^ Cl;
  Bh = rotrBH2(xh, xl, 63);
  Bl = rotrBL2(xh, xl, 63);
  BBUF[2 * a] = Al;
  BBUF[2 * a + 1] = Ah;
  BBUF[2 * b] = Bl;
  BBUF[2 * b + 1] = Bh;
  BBUF[2 * c] = Cl;
  BBUF[2 * c + 1] = Ch;
  BBUF[2 * d] = Dl;
  BBUF[2 * d + 1] = Dh;
}
function checkBlake2Opts(outputLen, opts = {}, keyLen, saltLen, persLen) {
  anumber2(keyLen);
  if (outputLen <= 0 || outputLen > keyLen)
    throw new Error('"dkLen" must be 1..' + keyLen + ", got " + outputLen);
  const { key, salt, personalization } = opts;
  if (key !== undefined && (key.length < 1 || key.length > keyLen))
    throw new Error('"key" expected to be undefined or of length=1..' + keyLen);
  if (salt !== undefined)
    abytes2(salt, saltLen, "salt");
  if (personalization !== undefined)
    abytes2(personalization, persLen, "personalization");
}

class _BLAKE2 {
  buffer;
  buffer32;
  finished = false;
  destroyed = false;
  length = 0;
  pos = 0;
  blockLen;
  outputLen;
  canXOF = false;
  constructor(blockLen, outputLen) {
    anumber2(blockLen);
    anumber2(outputLen);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.buffer = new Uint8Array(blockLen);
    this.buffer32 = u32(this.buffer);
  }
  update(data) {
    aexists2(this);
    abytes2(data);
    const { blockLen, buffer, buffer32 } = this;
    const len = data.length;
    const offset = data.byteOffset;
    const buf = data.buffer;
    for (let pos = 0;pos < len; ) {
      if (this.pos === blockLen) {
        swap32IfBE(buffer32);
        this.compress(buffer32, 0, false);
        swap32IfBE(buffer32);
        this.pos = 0;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      const dataOffset = offset + pos;
      if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
        const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
        swap32IfBE(data32);
        for (let pos32 = 0;pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
          this.length += blockLen;
          this.compress(data32, pos32, false);
        }
        swap32IfBE(data32);
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      this.length += take;
      pos += take;
    }
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    if (out.byteOffset & 3)
      throw new RangeError('"output" expected 4-byte aligned byteOffset, got ' + out.byteOffset);
    const { pos, buffer32 } = this;
    this.finished = true;
    this.buffer.fill(0, pos);
    swap32IfBE(buffer32);
    this.compress(buffer32, 0, true);
    swap32IfBE(buffer32);
    const state = this.get();
    const out32 = out === this.buffer ? buffer32 : u32(out);
    const full = Math.floor(this.outputLen / 4);
    for (let i = 0;i < full; i++)
      out32[i] = swap8IfBE(state[i]);
    const tail = this.outputLen % 4;
    if (!tail)
      return;
    const off = full * 4;
    const word = state[full];
    for (let i = 0;i < tail; i++)
      out[off + i] = word >>> 8 * i;
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    const { buffer, length, finished, destroyed, outputLen, pos } = this;
    to ||= new this.constructor({ dkLen: outputLen });
    to.set(...this.get());
    to.buffer.set(buffer);
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    to.outputLen = outputLen;
    return to;
  }
  clone() {
    return this._cloneInto();
  }
}

class _BLAKE2b extends _BLAKE2 {
  v0l = B2B_IV[0] | 0;
  v0h = B2B_IV[1] | 0;
  v1l = B2B_IV[2] | 0;
  v1h = B2B_IV[3] | 0;
  v2l = B2B_IV[4] | 0;
  v2h = B2B_IV[5] | 0;
  v3l = B2B_IV[6] | 0;
  v3h = B2B_IV[7] | 0;
  v4l = B2B_IV[8] | 0;
  v4h = B2B_IV[9] | 0;
  v5l = B2B_IV[10] | 0;
  v5h = B2B_IV[11] | 0;
  v6l = B2B_IV[12] | 0;
  v6h = B2B_IV[13] | 0;
  v7l = B2B_IV[14] | 0;
  v7h = B2B_IV[15] | 0;
  constructor(opts = {}) {
    opts = checkOpts({}, opts);
    const olen = opts.dkLen === undefined ? 64 : opts.dkLen;
    super(128, olen);
    checkBlake2Opts(olen, opts, 64, 16, 16);
    let { key, personalization, salt } = opts;
    let keyLength = 0;
    if (key !== undefined) {
      abytes2(key, undefined, "key");
      keyLength = key.length;
    }
    this.v0l ^= this.outputLen | keyLength << 8 | 1 << 16 | 1 << 24;
    if (salt !== undefined) {
      abytes2(salt, undefined, "salt");
      const slt = u32(copyBytes2(salt));
      this.v4l ^= swap8IfBE(slt[0]);
      this.v4h ^= swap8IfBE(slt[1]);
      this.v5l ^= swap8IfBE(slt[2]);
      this.v5h ^= swap8IfBE(slt[3]);
    }
    if (personalization !== undefined) {
      abytes2(personalization, undefined, "personalization");
      const pers = u32(copyBytes2(personalization));
      this.v6l ^= swap8IfBE(pers[0]);
      this.v6h ^= swap8IfBE(pers[1]);
      this.v7l ^= swap8IfBE(pers[2]);
      this.v7h ^= swap8IfBE(pers[3]);
    }
    if (key !== undefined) {
      const tmp = new Uint8Array(this.blockLen);
      tmp.set(key);
      this.update(tmp);
      clean2(tmp);
    }
  }
  get() {
    let { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
    return [v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h];
  }
  set(v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h) {
    this.v0l = v0l | 0;
    this.v0h = v0h | 0;
    this.v1l = v1l | 0;
    this.v1h = v1h | 0;
    this.v2l = v2l | 0;
    this.v2h = v2h | 0;
    this.v3l = v3l | 0;
    this.v3h = v3h | 0;
    this.v4l = v4l | 0;
    this.v4h = v4h | 0;
    this.v5l = v5l | 0;
    this.v5h = v5h | 0;
    this.v6l = v6l | 0;
    this.v6h = v6h | 0;
    this.v7l = v7l | 0;
    this.v7h = v7h | 0;
  }
  compress(msg, offset, isLast) {
    const { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
    {
      BBUF[0] = v0l;
      BBUF[1] = v0h;
      BBUF[2] = v1l;
      BBUF[3] = v1h;
      BBUF[4] = v2l;
      BBUF[5] = v2h;
      BBUF[6] = v3l;
      BBUF[7] = v3h;
      BBUF[8] = v4l;
      BBUF[9] = v4h;
      BBUF[10] = v5l;
      BBUF[11] = v5h;
      BBUF[12] = v6l;
      BBUF[13] = v6h;
      BBUF[14] = v7l;
      BBUF[15] = v7h;
    }
    BBUF.set(B2B_IV, 16);
    const l = fromNumL(this.length);
    const h = fromNumH(this.length);
    BBUF[24] = B2B_IV[8] ^ l;
    BBUF[25] = B2B_IV[9] ^ h;
    if (isLast) {
      BBUF[28] = ~BBUF[28];
      BBUF[29] = ~BBUF[29];
    }
    let j = 0;
    const s = BSIGMA;
    for (let i = 0;i < 12; i++) {
      G1b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
      G2b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
      G1b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
      G2b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
      G1b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
      G2b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
      G1b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
      G2b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
      G1b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
      G2b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
      G1b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
      G2b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
      G1b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
      G2b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
      G1b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
      G2b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
    }
    this.v0l ^= BBUF[0] ^ BBUF[16];
    this.v0h ^= BBUF[1] ^ BBUF[17];
    this.v1l ^= BBUF[2] ^ BBUF[18];
    this.v1h ^= BBUF[3] ^ BBUF[19];
    this.v2l ^= BBUF[4] ^ BBUF[20];
    this.v2h ^= BBUF[5] ^ BBUF[21];
    this.v3l ^= BBUF[6] ^ BBUF[22];
    this.v3h ^= BBUF[7] ^ BBUF[23];
    this.v4l ^= BBUF[8] ^ BBUF[24];
    this.v4h ^= BBUF[9] ^ BBUF[25];
    this.v5l ^= BBUF[10] ^ BBUF[26];
    this.v5h ^= BBUF[11] ^ BBUF[27];
    this.v6l ^= BBUF[12] ^ BBUF[28];
    this.v6h ^= BBUF[13] ^ BBUF[29];
    this.v7l ^= BBUF[14] ^ BBUF[30];
    this.v7h ^= BBUF[15] ^ BBUF[31];
    clean2(BBUF);
  }
  destroy() {
    this.destroyed = true;
    clean2(this.buffer32);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
}
var blake2b = /* @__PURE__ */ createHasher2((opts) => new _BLAKE2b(opts));
function _compress(s, offset, msg, rounds, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15) {
  let j = 0;
  for (let i = 0;i < rounds; i++) {
    ({ a: v0, b: v4, c: v8, d: v12 } = G1s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v0, b: v4, c: v8, d: v12 } = G2s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G1s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G2s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G1s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G2s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G1s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G2s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G1s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G2s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G1s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G2s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G1s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G2s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G1s(v3, v4, v9, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G2s(v3, v4, v9, v14, msg[offset + s[j++]]));
  }
  return { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 };
}
var B2S_IV = /* @__PURE__ */ SHA256_IV2.slice();

class _BLAKE2s extends _BLAKE2 {
  v0 = B2S_IV[0] | 0;
  v1 = B2S_IV[1] | 0;
  v2 = B2S_IV[2] | 0;
  v3 = B2S_IV[3] | 0;
  v4 = B2S_IV[4] | 0;
  v5 = B2S_IV[5] | 0;
  v6 = B2S_IV[6] | 0;
  v7 = B2S_IV[7] | 0;
  constructor(opts = {}) {
    opts = checkOpts({}, opts);
    const olen = opts.dkLen === undefined ? 32 : opts.dkLen;
    super(64, olen);
    checkBlake2Opts(olen, opts, 32, 8, 8);
    let { key, personalization, salt } = opts;
    let keyLength = 0;
    if (key !== undefined) {
      abytes2(key, undefined, "key");
      keyLength = key.length;
    }
    this.v0 ^= this.outputLen | keyLength << 8 | 1 << 16 | 1 << 24;
    if (salt !== undefined) {
      abytes2(salt, undefined, "salt");
      const slt = u32(copyBytes2(salt));
      this.v4 ^= swap8IfBE(slt[0]);
      this.v5 ^= swap8IfBE(slt[1]);
    }
    if (personalization !== undefined) {
      abytes2(personalization, undefined, "personalization");
      const pers = u32(copyBytes2(personalization));
      this.v6 ^= swap8IfBE(pers[0]);
      this.v7 ^= swap8IfBE(pers[1]);
    }
    if (key !== undefined) {
      const tmp = new Uint8Array(this.blockLen);
      tmp.set(key);
      this.update(tmp);
      clean2(tmp);
    }
  }
  get() {
    const { v0, v1, v2, v3, v4, v5, v6, v7 } = this;
    return [v0, v1, v2, v3, v4, v5, v6, v7];
  }
  set(v0, v1, v2, v3, v4, v5, v6, v7) {
    this.v0 = v0 | 0;
    this.v1 = v1 | 0;
    this.v2 = v2 | 0;
    this.v3 = v3 | 0;
    this.v4 = v4 | 0;
    this.v5 = v5 | 0;
    this.v6 = v6 | 0;
    this.v7 = v7 | 0;
  }
  compress(msg, offset, isLast) {
    const l = fromNumL(this.length);
    const h = fromNumH(this.length);
    const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = _compress(BSIGMA, offset, msg, 10, this.v0, this.v1, this.v2, this.v3, this.v4, this.v5, this.v6, this.v7, B2S_IV[0], B2S_IV[1], B2S_IV[2], B2S_IV[3], l ^ B2S_IV[4], h ^ B2S_IV[5], isLast ? ~B2S_IV[6] : B2S_IV[6], B2S_IV[7]);
    this.v0 ^= v0 ^ v8;
    this.v1 ^= v1 ^ v9;
    this.v2 ^= v2 ^ v10;
    this.v3 ^= v3 ^ v11;
    this.v4 ^= v4 ^ v12;
    this.v5 ^= v5 ^ v13;
    this.v6 ^= v6 ^ v14;
    this.v7 ^= v7 ^ v15;
  }
  destroy() {
    this.destroyed = true;
    clean2(this.buffer32);
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
  }
}
var blake2s = /* @__PURE__ */ createHasher2((opts) => new _BLAKE2s(opts));

// node_modules/@noble/hashes/hmac.js
class _HMAC {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash(hash);
    abytes2(key, undefined, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("expected Hash instance");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0;i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0;i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean2(pad);
  }
  update(buf) {
    aexists2(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.canXOF = canXOF;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
}
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = (hash, key, message) => new _HMAC(hash, key).update(message).digest();
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();

// node_modules/@lukeburns/clatterjs/dist/crypto/hash.js
function makeHash(name, hash, hashLen, blockLen) {
  const doHash = (data) => hash.create().update(data).digest();
  const hmac1 = (key, data) => hmac(hash, key, data);
  const hmacMany = (key, parts) => hmac1(key, parts.length === 1 ? parts[0] : concatBytes2(...parts));
  return {
    name,
    hashLen,
    blockLen,
    hash: doHash,
    hmac: hmac1,
    hmacMany,
    hkdf(ck, ikm) {
      const temp = hmac1(ck, ikm);
      const o1 = hmac1(temp, new Uint8Array([1]));
      const o2 = hmacMany(temp, [o1, new Uint8Array([2])]);
      return [o1, o2];
    },
    hkdf3(ck, ikm) {
      const temp = hmac1(ck, ikm);
      const o1 = hmac1(temp, new Uint8Array([1]));
      const o2 = hmacMany(temp, [o1, new Uint8Array([2])]);
      const o3 = hmacMany(temp, [o2, new Uint8Array([3])]);
      return [o1, o2, o3];
    },
    newOutput() {
      return new Uint8Array(hashLen);
    }
  };
}
var sha256H = makeHash("SHA256", sha256, 32, 64);
var sha512H = makeHash("SHA512", sha5122, 64, 128);
var blake2bH = makeHash("BLAKE2b", blake2b, 64, 128);
var blake2sH = makeHash("BLAKE2s", blake2s, 32, 64);
// node_modules/@noble/ciphers/utils.js
/*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) */
function isBytes4(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle3 = (title) => title ? `"${title}" ` : "";
function abool2(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle3(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function anumber4(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle3(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle3(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes4(value, length, title = "") {
  if (isBytes4(value) && (length === undefined || value.length === length))
    return value;
  if (length !== undefined)
    anumber4(length, "length");
  const bytes = isBytes4(value);
  const ofLen = length !== undefined ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle3(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
var aobject3 = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(label === "object" ? "expected valid options object" : `"${label}" expected object, got type=${typeof value}`);
};
function aexists3(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput3(out, instance) {
  abytes4(out, undefined, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function aoutput32(out, instance) {
  aoutput3(out, instance);
  if (!isAligned32(out))
    throw new Error("invalid output, must be aligned");
}
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u322(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean3(...arrays) {
  for (let i = 0;i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView3(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var isLE2 = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap2(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
var swap8IfBE2 = isLE2 ? (n) => n : (n) => byteSwap2(n) >>> 0;
function byteSwap322(arr) {
  for (let i = 0;i < arr.length; i++) {
    arr[i] = byteSwap2(arr[i]);
  }
  return arr;
}
var swap32IfBE2 = isLE2 ? (u) => u : byteSwap322;
function checkOpts2(defaults, opts) {
  aobject3(defaults, "defaults");
  aobject3(opts, "opts");
  const merged = Object.assign(defaults, opts);
  return merged;
}
function equalBytes2(a, b) {
  a = abytes4(a);
  b = abytes4(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0;i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function wrapMacConstructor(keyLen, macCons, fromMsg) {
  const mac = macCons;
  const getArgs = fromMsg || (() => []);
  const macC = (msg, key) => mac(key, ...getArgs(msg)).update(msg).digest();
  const tmp = mac(new Uint8Array(keyLen), ...getArgs(new Uint8Array(0)));
  macC.outputLen = tmp.outputLen;
  macC.blockLen = tmp.blockLen;
  macC.create = (key, ...args) => mac(key, ...args);
  return macC;
}
var wrapCipher = (params, constructor) => {
  function wrappedCipher(key, ...args) {
    abytes4(key, undefined, "key");
    if (params.nonceLength !== undefined) {
      const nonce = args[0];
      abytes4(nonce, params.varSizeNonce ? undefined : params.nonceLength, "nonce");
    }
    const tagl = params.tagLength;
    const aadStart = params.nonceLength !== undefined ? 1 : 0;
    if (!params.withAAD) {
      for (let i = aadStart;i < args.length; i++)
        if (isBytes4(args[i]))
          throw new Error("AAD not supported");
    }
    if (params.withAAD && args[aadStart] !== undefined)
      abytes4(args[aadStart], undefined, "AAD");
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== undefined) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes4(output, undefined, "output");
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes4(data, undefined, "data");
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes4(data, undefined, "data");
        if (tagl && data.length < tagl)
          throw new Error('"ciphertext" expected length >= tagLength=' + tagl);
        checkOutput(cipher.decrypt.length, output);
        return cipher.decrypt(data, output);
      }
    };
    return wrCipher;
  }
  Object.assign(wrappedCipher, params);
  return wrappedCipher;
};
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === undefined)
    return new Uint8Array(expectedLength);
  abytes4(out, expectedLength, "output");
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function u64Lengths(dataLength, aadLength, isLE) {
  anumber4(dataLength);
  anumber4(aadLength);
  abool2(isLE);
  const num = new Uint8Array(16);
  const view = createView3(num);
  view.setBigUint64(0, BigInt(aadLength), isLE);
  view.setBigUint64(8, BigInt(dataLength), isLE);
  return num;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes4(bytes) {
  return Uint8Array.from(abytes4(bytes));
}

// node_modules/@noble/ciphers/_polyval.js
var BLOCK_SIZE = 16;
var ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
var ZEROS32 = /* @__PURE__ */ u322(ZEROS16);
var POLY = 225;
var mul2 = (s0, s1, s2, s3) => {
  const hiBit = s3 & 1;
  return {
    s3: s2 << 31 | s3 >>> 1,
    s2: s1 << 31 | s2 >>> 1,
    s1: s0 << 31 | s1 >>> 1,
    s0: s0 >>> 1 ^ POLY << 24 & -(hiBit & 1)
  };
};
var swapLE = (n) => (n >>> 0 & 255) << 24 | (n >>> 8 & 255) << 16 | (n >>> 16 & 255) << 8 | n >>> 24 & 255 | 0;
var estimateWindow = (bytes) => {
  if (bytes > 64 * 1024)
    return 8;
  if (bytes > 1024)
    return 4;
  return 2;
};

class GHASH {
  blockLen = BLOCK_SIZE;
  outputLen = BLOCK_SIZE;
  s0 = 0;
  s1 = 0;
  s2 = 0;
  s3 = 0;
  finished = false;
  destroyed = false;
  t;
  W;
  windowSize;
  constructor(key, expectedLength) {
    abytes4(key, 16, "key");
    key = copyBytes4(key);
    const kView = createView3(key);
    let k0 = kView.getUint32(0, false);
    let k1 = kView.getUint32(4, false);
    let k2 = kView.getUint32(8, false);
    let k3 = kView.getUint32(12, false);
    const doubles = [];
    for (let i = 0;i < 128; i++) {
      doubles.push({ s0: swapLE(k0), s1: swapLE(k1), s2: swapLE(k2), s3: swapLE(k3) });
      ({ s0: k0, s1: k1, s2: k2, s3: k3 } = mul2(k0, k1, k2, k3));
    }
    const W = estimateWindow(expectedLength || 1024);
    if (![1, 2, 4, 8].includes(W))
      throw new Error("ghash: invalid window size, expected 2, 4 or 8");
    this.W = W;
    const bits = 128;
    const windows = bits / W;
    const windowSize = this.windowSize = 2 ** W;
    const items = [];
    for (let w = 0;w < windows; w++) {
      for (let byte = 0;byte < windowSize; byte++) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (let j = 0;j < W; j++) {
          const bit = byte >>> W - j - 1 & 1;
          if (!bit)
            continue;
          const { s0: d0, s1: d1, s2: d2, s3: d3 } = doubles[W * w + j];
          s0 ^= d0, s1 ^= d1, s2 ^= d2, s3 ^= d3;
        }
        items.push({ s0, s1, s2, s3 });
      }
    }
    this.t = items;
  }
  _updateBlock(s0, s1, s2, s3) {
    s0 ^= this.s0, s1 ^= this.s1, s2 ^= this.s2, s3 ^= this.s3;
    const { W, t, windowSize } = this;
    let o0 = 0, o1 = 0, o2 = 0, o3 = 0;
    const mask = (1 << W) - 1;
    let w = 0;
    for (const num of [s0, s1, s2, s3]) {
      for (let bytePos = 0;bytePos < 4; bytePos++) {
        const byte = num >>> 8 * bytePos & 255;
        for (let bitPos = 8 / W - 1;bitPos >= 0; bitPos--) {
          const bit = byte >>> W * bitPos & mask;
          const { s0: e0, s1: e1, s2: e2, s3: e3 } = t[w * windowSize + bit];
          o0 ^= e0, o1 ^= e1, o2 ^= e2, o3 ^= e3;
          w += 1;
        }
      }
    }
    this.s0 = o0;
    this.s1 = o1;
    this.s2 = o2;
    this.s3 = o3;
  }
  update(data) {
    aexists3(this);
    abytes4(data);
    data = copyBytes4(data);
    const b32 = u322(data);
    const blocks = Math.floor(data.length / BLOCK_SIZE);
    const left = data.length % BLOCK_SIZE;
    for (let i = 0;i < blocks; i++) {
      this._updateBlock(swap8IfBE2(b32[i * 4 + 0]), swap8IfBE2(b32[i * 4 + 1]), swap8IfBE2(b32[i * 4 + 2]), swap8IfBE2(b32[i * 4 + 3]));
    }
    if (left) {
      ZEROS16.set(data.subarray(blocks * BLOCK_SIZE));
      this._updateBlock(swap8IfBE2(ZEROS32[0]), swap8IfBE2(ZEROS32[1]), swap8IfBE2(ZEROS32[2]), swap8IfBE2(ZEROS32[3]));
      clean3(ZEROS32);
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    const { t } = this;
    for (const elm of t) {
      elm.s0 = 0, elm.s1 = 0, elm.s2 = 0, elm.s3 = 0;
    }
  }
  digestInto(out) {
    aexists3(this);
    aoutput32(out, this);
    this.finished = true;
    const { s0, s1, s2, s3 } = this;
    const o32 = u322(out);
    o32[0] = s0;
    o32[1] = s1;
    o32[2] = s2;
    o32[3] = s3;
    if (!isLE2)
      swap32IfBE2(o32.subarray(0, BLOCK_SIZE / 4));
  }
  digest() {
    const res = new Uint8Array(BLOCK_SIZE);
    this.digestInto(res);
    this.destroy();
    return res;
  }
}
var ghash = /* @__PURE__ */ wrapMacConstructor(16, (key, expectedLength) => new GHASH(key, expectedLength), (msg) => [msg.length]);

// node_modules/@noble/ciphers/aes.js
var BLOCK_SIZE2 = 16;
var BLOCK_SIZE32 = 4;
var EMPTY_BLOCK = /* @__PURE__ */ new Uint8Array(BLOCK_SIZE2);
var POLY2 = 283;
function validateKeyLength(key) {
  if (![16, 24, 32].includes(key.length))
    throw new Error('"aes key" expected Uint8Array of length 16/24/32, got length=' + key.length);
}
function mul22(n) {
  return n << 1 ^ POLY2 & -(n >> 7);
}
function mul(a, b) {
  let res = 0;
  for (;b > 0; b >>= 1) {
    res ^= a & -(b & 1);
    a = mul22(a);
  }
  return res;
}
var sbox = /* @__PURE__ */ (() => {
  const t = new Uint8Array(256);
  for (let i = 0, x = 1;i < 256; i++, x ^= mul22(x))
    t[i] = x;
  const box = new Uint8Array(256);
  box[0] = 99;
  for (let i = 0;i < 255; i++) {
    let x = t[255 - i];
    x |= x << 8;
    box[t[i]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
  }
  clean3(t);
  return box;
})();
var rotr32_8 = (n) => n << 24 | n >>> 8;
var rotl32_8 = (n) => n << 8 | n >>> 24;
function genTtable(sbox, fn) {
  if (sbox.length !== 256)
    throw new Error("wrong sbox length");
  const T0 = new Uint32Array(256).map((_, j) => fn(sbox[j]));
  const T1 = T0.map(rotl32_8);
  const T2 = T1.map(rotl32_8);
  const T3 = T2.map(rotl32_8);
  const T01 = new Uint32Array(256 * 256);
  const T23 = new Uint32Array(256 * 256);
  const sbox2 = new Uint16Array(256 * 256);
  for (let i = 0;i < 256; i++) {
    for (let j = 0;j < 256; j++) {
      const idx = i * 256 + j;
      T01[idx] = T0[i] ^ T1[j];
      T23[idx] = T2[i] ^ T3[j];
      sbox2[idx] = sbox[i] << 8 | sbox[j];
    }
  }
  return { sbox, sbox2, T0, T1, T2, T3, T01, T23 };
}
var tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
var xPowers = /* @__PURE__ */ (() => {
  const p = new Uint8Array(16);
  for (let i = 0, x = 1;i < 16; i++, x = mul22(x))
    p[i] = x;
  return p;
})();
function expandKeyLE(key) {
  abytes4(key);
  const len = key.length;
  validateKeyLength(key);
  const { sbox2 } = tableEncoding;
  const toClean = [];
  if (!isLE2 || !isAligned32(key))
    toClean.push(key = copyBytes4(key));
  const k32 = swap32IfBE2(u322(key));
  const Nk = k32.length;
  const subByte = (n) => applySbox(sbox2, n, n, n, n);
  const xk = new Uint32Array(len + 28);
  xk.set(k32);
  for (let i = Nk;i < xk.length; i++) {
    let t = xk[i - 1];
    if (i % Nk === 0)
      t = subByte(rotr32_8(t)) ^ xPowers[i / Nk - 1];
    else if (Nk > 6 && i % Nk === 4)
      t = subByte(t);
    xk[i] = xk[i - Nk] ^ t;
  }
  clean3(...toClean);
  return xk;
}
function apply0123(T01, T23, s0, s1, s2, s3) {
  return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
}
function applySbox(sbox2, s0, s1, s2, s3) {
  return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
}
function encrypt(xk, s0, s1, s2, s3) {
  const { sbox2, T01, T23 } = tableEncoding;
  let k = 0;
  s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0;i < rounds; i++) {
    const t0 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
    const t1 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
    const t2 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
    const t3 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
    s0 = t0, s1 = t1, s2 = t2, s3 = t3;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}
function ctr32(xk, isLE, nonce, src, dst) {
  abytes4(nonce, BLOCK_SIZE2, "nonce");
  abytes4(src);
  dst = getOutput(src.length, dst);
  const ctr = nonce;
  const c32 = u322(ctr);
  const view = createView3(ctr);
  const src32 = u322(src);
  const dst32 = u322(dst);
  const ctrPos = isLE ? 0 : 12;
  const srcLen = src.length;
  let ctrNum = view.getUint32(ctrPos, isLE);
  for (let i = 0;i + 4 <= src32.length; i += 4) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE2(c32[0]), swap8IfBE2(c32[1]), swap8IfBE2(c32[2]), swap8IfBE2(c32[3]));
    dst32[i + 0] = src32[i + 0] ^ swap8IfBE2(s0);
    dst32[i + 1] = src32[i + 1] ^ swap8IfBE2(s1);
    dst32[i + 2] = src32[i + 2] ^ swap8IfBE2(s2);
    dst32[i + 3] = src32[i + 3] ^ swap8IfBE2(s3);
    ctrNum = ctrNum + 1 >>> 0;
    view.setUint32(ctrPos, ctrNum, isLE);
  }
  const start = BLOCK_SIZE2 * Math.floor(src32.length / BLOCK_SIZE32);
  if (start < srcLen) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE2(c32[0]), swap8IfBE2(c32[1]), swap8IfBE2(c32[2]), swap8IfBE2(c32[3]));
    const b32 = new Uint32Array([s0, s1, s2, s3]);
    swap32IfBE2(b32);
    const buf = u8(b32);
    for (let i = start, pos = 0;i < srcLen; i++, pos++)
      dst[i] = src[i] ^ buf[pos];
    clean3(b32);
  }
  return dst;
}
function computeTag(fn, isLE, key, data, AAD) {
  const aadLength = AAD ? AAD.length : 0;
  const h = fn.create(key, data.length + aadLength);
  if (AAD)
    h.update(AAD);
  const num = u64Lengths(8 * data.length, 8 * aadLength, isLE);
  h.update(data);
  h.update(num);
  const res = h.digest();
  clean3(num);
  return res;
}
var gcm = /* @__PURE__ */ wrapCipher({ blockSize: 16, nonceLength: 12, tagLength: 16, withAAD: true, varSizeNonce: true }, function aesgcm(key, nonce, AAD) {
  if (nonce.length < 8)
    throw new Error("aes/gcm: invalid nonce length");
  const tagLength = 16;
  function _computeTag(authKey, tagMask, data) {
    const tag = computeTag(ghash, false, authKey, data, AAD);
    for (let i = 0;i < tagMask.length; i++)
      tag[i] ^= tagMask[i];
    return tag;
  }
  function deriveKeys() {
    const xk = expandKeyLE(key);
    const authKey = EMPTY_BLOCK.slice();
    const counter = EMPTY_BLOCK.slice();
    ctr32(xk, false, counter, counter, authKey);
    if (nonce.length === 12) {
      counter.set(nonce);
    } else {
      const nonceLen = EMPTY_BLOCK.slice();
      const view = createView3(nonceLen);
      view.setBigUint64(8, BigInt(nonce.length * 8), false);
      const g = ghash.create(authKey).update(nonce).update(nonceLen);
      g.digestInto(counter);
      g.destroy();
    }
    const tagMask = ctr32(xk, false, counter, EMPTY_BLOCK);
    return { xk, authKey, counter, tagMask };
  }
  return {
    encrypt(plaintext) {
      const { xk, authKey, counter, tagMask } = deriveKeys();
      const out = new Uint8Array(plaintext.length + tagLength);
      const toClean = [xk, authKey, counter, tagMask];
      if (!isAligned32(plaintext))
        toClean.push(plaintext = copyBytes4(plaintext));
      ctr32(xk, false, counter, plaintext, out.subarray(0, plaintext.length));
      const tag = _computeTag(authKey, tagMask, out.subarray(0, out.length - tagLength));
      toClean.push(tag);
      out.set(tag, plaintext.length);
      clean3(...toClean);
      return out;
    },
    decrypt(ciphertext) {
      const { xk, authKey, counter, tagMask } = deriveKeys();
      const toClean = [xk, authKey, tagMask, counter];
      if (!isAligned32(ciphertext))
        toClean.push(ciphertext = copyBytes4(ciphertext));
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = _computeTag(authKey, tagMask, data);
      toClean.push(tag);
      if (!equalBytes2(tag, passedTag)) {
        clean3(...toClean);
        throw new Error("aes-gcm: invalid tag");
      }
      const out = ctr32(xk, false, counter, data);
      clean3(...toClean);
      return out;
    }
  };
});

// node_modules/@noble/ciphers/_arx.js
var encodeStr = (str) => Uint8Array.from(str.split(""), (c) => c.charCodeAt(0));
var sigma16_32 = /* @__PURE__ */ (() => swap32IfBE2(u322(encodeStr("expand 16-byte k"))))();
var sigma32_32 = /* @__PURE__ */ (() => swap32IfBE2(u322(encodeStr("expand 32-byte k"))))();
function rotl(a, b) {
  return a << b | a >>> 32 - b;
}
var BLOCK_LEN = 64;
var BLOCK_LEN32 = 16;
var MAX_COUNTER = /* @__PURE__ */ (() => 2 ** 32 - 1)();
var U32_EMPTY = /* @__PURE__ */ Uint32Array.of();
function runCipher(core, sigma, key, nonce, data, output, counter, rounds) {
  const len = data.length;
  const block = new Uint8Array(BLOCK_LEN);
  const b32 = u322(block);
  const isAligned = isLE2 && isAligned32(data) && isAligned32(output);
  const d32 = isAligned ? u322(data) : U32_EMPTY;
  const o32 = isAligned ? u322(output) : U32_EMPTY;
  if (!isLE2) {
    for (let pos = 0;pos < len; counter++) {
      core(sigma, key, nonce, b32, counter, rounds);
      swap32IfBE2(b32);
      if (counter >= MAX_COUNTER)
        throw new Error("arx: counter overflow");
      const take = Math.min(BLOCK_LEN, len - pos);
      for (let j = 0, posj;j < take; j++) {
        posj = pos + j;
        output[posj] = data[posj] ^ block[j];
      }
      pos += take;
    }
    return;
  }
  for (let pos = 0;pos < len; counter++) {
    core(sigma, key, nonce, b32, counter, rounds);
    if (counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const take = Math.min(BLOCK_LEN, len - pos);
    if (isAligned && take === BLOCK_LEN) {
      const pos32 = pos / 4;
      if (pos % 4 !== 0)
        throw new Error("arx: invalid block position");
      for (let j = 0, posj;j < BLOCK_LEN32; j++) {
        posj = pos32 + j;
        o32[posj] = d32[posj] ^ b32[j];
      }
      pos += BLOCK_LEN;
      continue;
    }
    for (let j = 0, posj;j < take; j++) {
      posj = pos + j;
      output[posj] = data[posj] ^ block[j];
    }
    pos += take;
  }
}
function createCipher(core, opts) {
  const { allowShortKeys, extendNonceFn, counterLength, counterRight, rounds } = checkOpts2({ allowShortKeys: false, counterLength: 8, counterRight: false, rounds: 20 }, opts);
  if (typeof core !== "function")
    throw new Error("core must be a function");
  anumber4(counterLength);
  anumber4(rounds);
  abool2(counterRight);
  abool2(allowShortKeys);
  return (key, nonce, data, output, counter = 0) => {
    abytes4(key, undefined, "key");
    abytes4(nonce, undefined, "nonce");
    abytes4(data, undefined, "data");
    const len = data.length;
    output = getOutput(len, output, false);
    anumber4(counter);
    if (counter < 0 || counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const toClean = [];
    let l = key.length;
    let k;
    let sigma;
    if (l === 32) {
      toClean.push(k = copyBytes4(key));
      sigma = sigma32_32;
    } else if (l === 16 && allowShortKeys) {
      k = new Uint8Array(32);
      k.set(key);
      k.set(key, 16);
      sigma = sigma16_32;
      toClean.push(k);
    } else {
      abytes4(key, 32, "arx key");
      throw new Error("invalid key size");
    }
    if (!isLE2 || !isAligned32(nonce))
      toClean.push(nonce = copyBytes4(nonce));
    let k32 = u322(k);
    if (extendNonceFn) {
      if (nonce.length !== 24)
        throw new Error("arx: extended nonce must be 24 bytes");
      const n16 = nonce.subarray(0, 16);
      if (isLE2)
        extendNonceFn(sigma, k32, u322(n16), k32);
      else {
        const sigmaRaw = swap32IfBE2(Uint32Array.from(sigma));
        extendNonceFn(sigmaRaw, k32, u322(n16), k32);
        clean3(sigmaRaw);
        swap32IfBE2(k32);
      }
      nonce = nonce.subarray(16);
    } else if (!isLE2)
      swap32IfBE2(k32);
    const nonceNcLen = 16 - counterLength;
    if (nonceNcLen !== nonce.length)
      throw new Error(`arx: nonce must be ${nonceNcLen} or 16 bytes`);
    if (nonceNcLen !== 12) {
      const nc = new Uint8Array(12);
      nc.set(nonce, counterRight ? 0 : 12 - nonce.length);
      nonce = nc;
      toClean.push(nonce);
    }
    const n32 = swap32IfBE2(u322(nonce));
    try {
      runCipher(core, sigma, k32, n32, data, output, counter, rounds);
      return output;
    } finally {
      clean3(...toClean);
    }
  };
}

// node_modules/@noble/ciphers/_poly1305.js
function u8to16(a, i) {
  return a[i++] & 255 | (a[i++] & 255) << 8;
}

class Poly1305 {
  blockLen = 16;
  outputLen = 16;
  buffer = new Uint8Array(16);
  r = new Uint16Array(10);
  h = new Uint16Array(10);
  pad = new Uint16Array(8);
  pos = 0;
  finished = false;
  destroyed = false;
  constructor(key) {
    key = copyBytes4(abytes4(key, 32, "key"));
    const t0 = u8to16(key, 0);
    const t1 = u8to16(key, 2);
    const t2 = u8to16(key, 4);
    const t3 = u8to16(key, 6);
    const t4 = u8to16(key, 8);
    const t5 = u8to16(key, 10);
    const t6 = u8to16(key, 12);
    const t7 = u8to16(key, 14);
    this.r[0] = t0 & 8191;
    this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
    this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
    this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
    this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
    this.r[5] = t4 >>> 1 & 8190;
    this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
    this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
    this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
    this.r[9] = t7 >>> 5 & 127;
    for (let i = 0;i < 8; i++)
      this.pad[i] = u8to16(key, 16 + 2 * i);
  }
  process(data, offset, isLast = false) {
    const hibit = isLast ? 0 : 1 << 11;
    const { h, r } = this;
    const r0 = r[0];
    const r1 = r[1];
    const r2 = r[2];
    const r3 = r[3];
    const r4 = r[4];
    const r5 = r[5];
    const r6 = r[6];
    const r7 = r[7];
    const r8 = r[8];
    const r9 = r[9];
    const t0 = u8to16(data, offset + 0);
    const t1 = u8to16(data, offset + 2);
    const t2 = u8to16(data, offset + 4);
    const t3 = u8to16(data, offset + 6);
    const t4 = u8to16(data, offset + 8);
    const t5 = u8to16(data, offset + 10);
    const t6 = u8to16(data, offset + 12);
    const t7 = u8to16(data, offset + 14);
    let h0 = h[0] + (t0 & 8191);
    let h1 = h[1] + ((t0 >>> 13 | t1 << 3) & 8191);
    let h2 = h[2] + ((t1 >>> 10 | t2 << 6) & 8191);
    let h3 = h[3] + ((t2 >>> 7 | t3 << 9) & 8191);
    let h4 = h[4] + ((t3 >>> 4 | t4 << 12) & 8191);
    let h5 = h[5] + (t4 >>> 1 & 8191);
    let h6 = h[6] + ((t4 >>> 14 | t5 << 2) & 8191);
    let h7 = h[7] + ((t5 >>> 11 | t6 << 5) & 8191);
    let h8 = h[8] + ((t6 >>> 8 | t7 << 8) & 8191);
    let h9 = h[9] + (t7 >>> 5 | hibit);
    let c = 0;
    let d0 = c + h0 * r0 + h1 * (5 * r9) + h2 * (5 * r8) + h3 * (5 * r7) + h4 * (5 * r6);
    c = d0 >>> 13;
    d0 &= 8191;
    d0 += h5 * (5 * r5) + h6 * (5 * r4) + h7 * (5 * r3) + h8 * (5 * r2) + h9 * (5 * r1);
    c += d0 >>> 13;
    d0 &= 8191;
    let d1 = c + h0 * r1 + h1 * r0 + h2 * (5 * r9) + h3 * (5 * r8) + h4 * (5 * r7);
    c = d1 >>> 13;
    d1 &= 8191;
    d1 += h5 * (5 * r6) + h6 * (5 * r5) + h7 * (5 * r4) + h8 * (5 * r3) + h9 * (5 * r2);
    c += d1 >>> 13;
    d1 &= 8191;
    let d2 = c + h0 * r2 + h1 * r1 + h2 * r0 + h3 * (5 * r9) + h4 * (5 * r8);
    c = d2 >>> 13;
    d2 &= 8191;
    d2 += h5 * (5 * r7) + h6 * (5 * r6) + h7 * (5 * r5) + h8 * (5 * r4) + h9 * (5 * r3);
    c += d2 >>> 13;
    d2 &= 8191;
    let d3 = c + h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * (5 * r9);
    c = d3 >>> 13;
    d3 &= 8191;
    d3 += h5 * (5 * r8) + h6 * (5 * r7) + h7 * (5 * r6) + h8 * (5 * r5) + h9 * (5 * r4);
    c += d3 >>> 13;
    d3 &= 8191;
    let d4 = c + h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;
    c = d4 >>> 13;
    d4 &= 8191;
    d4 += h5 * (5 * r9) + h6 * (5 * r8) + h7 * (5 * r7) + h8 * (5 * r6) + h9 * (5 * r5);
    c += d4 >>> 13;
    d4 &= 8191;
    let d5 = c + h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1;
    c = d5 >>> 13;
    d5 &= 8191;
    d5 += h5 * r0 + h6 * (5 * r9) + h7 * (5 * r8) + h8 * (5 * r7) + h9 * (5 * r6);
    c += d5 >>> 13;
    d5 &= 8191;
    let d6 = c + h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2;
    c = d6 >>> 13;
    d6 &= 8191;
    d6 += h5 * r1 + h6 * r0 + h7 * (5 * r9) + h8 * (5 * r8) + h9 * (5 * r7);
    c += d6 >>> 13;
    d6 &= 8191;
    let d7 = c + h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3;
    c = d7 >>> 13;
    d7 &= 8191;
    d7 += h5 * r2 + h6 * r1 + h7 * r0 + h8 * (5 * r9) + h9 * (5 * r8);
    c += d7 >>> 13;
    d7 &= 8191;
    let d8 = c + h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4;
    c = d8 >>> 13;
    d8 &= 8191;
    d8 += h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * (5 * r9);
    c += d8 >>> 13;
    d8 &= 8191;
    let d9 = c + h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5;
    c = d9 >>> 13;
    d9 &= 8191;
    d9 += h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
    c += d9 >>> 13;
    d9 &= 8191;
    c = (c << 2) + c | 0;
    c = c + d0 | 0;
    d0 = c & 8191;
    c = c >>> 13;
    d1 += c;
    h[0] = d0;
    h[1] = d1;
    h[2] = d2;
    h[3] = d3;
    h[4] = d4;
    h[5] = d5;
    h[6] = d6;
    h[7] = d7;
    h[8] = d8;
    h[9] = d9;
  }
  finalize() {
    const { h, pad } = this;
    const g = new Uint16Array(10);
    let c = h[1] >>> 13;
    h[1] &= 8191;
    for (let i = 2;i < 10; i++) {
      h[i] += c;
      c = h[i] >>> 13;
      h[i] &= 8191;
    }
    h[0] += c * 5;
    c = h[0] >>> 13;
    h[0] &= 8191;
    h[1] += c;
    c = h[1] >>> 13;
    h[1] &= 8191;
    h[2] += c;
    g[0] = h[0] + 5;
    c = g[0] >>> 13;
    g[0] &= 8191;
    for (let i = 1;i < 10; i++) {
      g[i] = h[i] + c;
      c = g[i] >>> 13;
      g[i] &= 8191;
    }
    g[9] -= 1 << 13;
    let mask = (c ^ 1) - 1;
    for (let i = 0;i < 10; i++)
      g[i] &= mask;
    mask = ~mask;
    for (let i = 0;i < 10; i++)
      h[i] = h[i] & mask | g[i];
    h[0] = (h[0] | h[1] << 13) & 65535;
    h[1] = (h[1] >>> 3 | h[2] << 10) & 65535;
    h[2] = (h[2] >>> 6 | h[3] << 7) & 65535;
    h[3] = (h[3] >>> 9 | h[4] << 4) & 65535;
    h[4] = (h[4] >>> 12 | h[5] << 1 | h[6] << 14) & 65535;
    h[5] = (h[6] >>> 2 | h[7] << 11) & 65535;
    h[6] = (h[7] >>> 5 | h[8] << 8) & 65535;
    h[7] = (h[8] >>> 8 | h[9] << 5) & 65535;
    let f = h[0] + pad[0];
    h[0] = f & 65535;
    for (let i = 1;i < 8; i++) {
      f = (h[i] + pad[i] | 0) + (f >>> 16) | 0;
      h[i] = f & 65535;
    }
    clean3(g);
  }
  update(data) {
    aexists3(this);
    abytes4(data);
    data = copyBytes4(data);
    const { buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0;pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        for (;blockLen <= len - pos; pos += blockLen)
          this.process(data, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(buffer, 0, false);
        this.pos = 0;
      }
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    clean3(this.h, this.r, this.buffer, this.pad);
  }
  digestInto(out) {
    aexists3(this);
    aoutput3(out, this);
    this.finished = true;
    const { buffer, h } = this;
    let { pos } = this;
    if (pos) {
      buffer[pos++] = 1;
      for (;pos < 16; pos++)
        buffer[pos] = 0;
      this.process(buffer, 0, true);
    }
    this.finalize();
    let opos = 0;
    for (let i = 0;i < 8; i++) {
      out[opos++] = h[i] >>> 0;
      out[opos++] = h[i] >>> 8;
    }
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
}
var poly1305 = /* @__PURE__ */ wrapMacConstructor(32, (key) => new Poly1305(key));

// node_modules/@noble/ciphers/chacha.js
function chachaCore(s, k, n, out, cnt, rounds = 20) {
  let y00 = s[0], y01 = s[1], y02 = s[2], y03 = s[3], y04 = k[0], y05 = k[1], y06 = k[2], y07 = k[3], y08 = k[4], y09 = k[5], y10 = k[6], y11 = k[7], y12 = cnt, y13 = n[0], y14 = n[1], y15 = n[2];
  let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
  for (let r = 0;r < rounds; r += 2) {
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 16);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 12);
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 8);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 7);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 16);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 12);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 8);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 7);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 16);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 12);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 8);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 7);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 16);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 12);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 8);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 7);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 16);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 12);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 8);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 7);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 16);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 12);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 8);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 7);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 16);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 12);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 8);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 7);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 16);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 12);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 8);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 7);
  }
  let oi = 0;
  out[oi++] = y00 + x00 | 0;
  out[oi++] = y01 + x01 | 0;
  out[oi++] = y02 + x02 | 0;
  out[oi++] = y03 + x03 | 0;
  out[oi++] = y04 + x04 | 0;
  out[oi++] = y05 + x05 | 0;
  out[oi++] = y06 + x06 | 0;
  out[oi++] = y07 + x07 | 0;
  out[oi++] = y08 + x08 | 0;
  out[oi++] = y09 + x09 | 0;
  out[oi++] = y10 + x10 | 0;
  out[oi++] = y11 + x11 | 0;
  out[oi++] = y12 + x12 | 0;
  out[oi++] = y13 + x13 | 0;
  out[oi++] = y14 + x14 | 0;
  out[oi++] = y15 + x15 | 0;
}
var chacha20 = /* @__PURE__ */ createCipher(chachaCore, {
  counterRight: false,
  counterLength: 4,
  allowShortKeys: false
});
var ZEROS162 = /* @__PURE__ */ new Uint8Array(16);
var updatePadded = (h, msg) => {
  h.update(msg);
  const leftover = msg.length % 16;
  if (leftover)
    h.update(ZEROS162.subarray(leftover));
};
var ZEROS322 = /* @__PURE__ */ new Uint8Array(32);
function computeTag2(fn, key, nonce, ciphertext, AAD) {
  if (AAD !== undefined)
    abytes4(AAD, undefined, "AAD");
  const authKey = fn(key, nonce, ZEROS322);
  const lengths = u64Lengths(ciphertext.length, AAD ? AAD.length : 0, true);
  const h = poly1305.create(authKey);
  if (AAD)
    updatePadded(h, AAD);
  updatePadded(h, ciphertext);
  h.update(lengths);
  const res = h.digest();
  clean3(authKey, lengths);
  return res;
}
var _poly1305_aead = (xorStream) => (key, nonce, AAD) => {
  const tagLength = 16;
  return {
    encrypt(plaintext, output) {
      const plength = plaintext.length;
      output = getOutput(plength + tagLength, output, false);
      output.set(plaintext);
      const oPlain = output.subarray(0, -tagLength);
      xorStream(key, nonce, oPlain, oPlain, 1);
      const tag = computeTag2(xorStream, key, nonce, oPlain, AAD);
      output.set(tag, plength);
      clean3(tag);
      return output;
    },
    decrypt(ciphertext, output) {
      output = getOutput(ciphertext.length - tagLength, output, false);
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = computeTag2(xorStream, key, nonce, data, AAD);
      if (!equalBytes2(passedTag, tag)) {
        clean3(tag);
        throw new Error("invalid tag");
      }
      output.set(ciphertext.subarray(0, -tagLength));
      xorStream(key, nonce, output, output, 1);
      clean3(tag);
      return output;
    }
  };
};
var chacha20poly1305 = /* @__PURE__ */ wrapCipher({ blockSize: 64, nonceLength: 12, tagLength: 16, withAAD: true }, /* @__PURE__ */ _poly1305_aead(chacha20));

// node_modules/@lukeburns/clatterjs/dist/crypto/cipher.js
var U64_MAX2 = 0xfffffffffffffffn;
function chachaNonce(n) {
  const b = new Uint8Array(12);
  new DataView(b.buffer).setBigUint64(4, n, true);
  return b;
}
function aesNonce(n) {
  const b = new Uint8Array(12);
  new DataView(b.buffer).setBigUint64(4, n, false);
  return b;
}
function asErr(e, op) {
  if (e instanceof CipherError)
    return e;
  return new CipherError(op, e instanceof Error ? e.message : String(e));
}
var chachaPoly = (() => {
  const keyLen = 32;
  const tagLen = 16;
  return {
    name: "ChaChaPoly",
    keyLen,
    tagLen,
    encrypt(key, nonce, ad, plaintext, out) {
      const ct = chacha20poly1305(key, chachaNonce(nonce), ad).encrypt(plaintext);
      out.set(ct);
    },
    encryptInPlace(key, nonce, ad, inOut, plaintextLen) {
      const sub = inOut.subarray(0, plaintextLen + tagLen);
      const pt = inOut.subarray(0, plaintextLen);
      try {
        const ct = chacha20poly1305(key, chachaNonce(nonce), ad).encrypt(pt);
        sub.set(ct);
        return ct.length;
      } catch (e) {
        throw asErr(e, "Encrypt");
      }
    },
    decrypt(key, nonce, ad, ciphertext, out) {
      try {
        const pt = chacha20poly1305(key, chachaNonce(nonce), ad).decrypt(ciphertext);
        out.set(pt);
      } catch (e) {
        throw asErr(e, "Decrypt");
      }
    },
    decryptInPlace(key, nonce, ad, inOut, ciphertextLen) {
      const sub = inOut.subarray(0, ciphertextLen);
      try {
        const pt = chacha20poly1305(key, chachaNonce(nonce), ad).decrypt(sub);
        inOut.set(pt);
        return pt.length;
      } catch (e) {
        throw asErr(e, "Decrypt");
      }
    },
    rekey(key) {
      const kNew = new Uint8Array(MAX_KEY_LEN + MAX_TAG_LEN);
      const z = new Uint8Array(keyLen);
      const ct = chacha20poly1305(key, chachaNonce(U64_MAX2), new Uint8Array(0)).encrypt(z);
      kNew.set(ct);
      return kNew.subarray(0, keyLen);
    }
  };
})();
var aesGcm = (() => {
  const keyLen = 32;
  const tagLen = 16;
  return {
    name: "AESGCM",
    keyLen,
    tagLen,
    encrypt(key, nonce, ad, plaintext, out) {
      const ct = gcm(key, aesNonce(nonce), ad).encrypt(plaintext);
      out.set(ct);
    },
    encryptInPlace(key, nonce, ad, inOut, plaintextLen) {
      const pt = inOut.subarray(0, plaintextLen);
      try {
        const ct = gcm(key, aesNonce(nonce), ad).encrypt(pt);
        inOut.subarray(0, ct.length).set(ct);
        return ct.length;
      } catch (e) {
        throw asErr(e, "Encrypt");
      }
    },
    decrypt(key, nonce, ad, ciphertext, out) {
      try {
        const pt = gcm(key, aesNonce(nonce), ad).decrypt(ciphertext);
        out.set(pt);
      } catch (e) {
        throw asErr(e, "Decrypt");
      }
    },
    decryptInPlace(key, nonce, ad, inOut, ciphertextLen) {
      const sub = inOut.subarray(0, ciphertextLen);
      try {
        const pt = gcm(key, aesNonce(nonce), ad).decrypt(sub);
        inOut.set(pt);
        return pt.length;
      } catch (e) {
        throw asErr(e, "Decrypt");
      }
    },
    rekey(key) {
      const kNew = new Uint8Array(MAX_KEY_LEN + MAX_TAG_LEN);
      const z = new Uint8Array(keyLen);
      const ct = gcm(key, aesNonce(U64_MAX2), new Uint8Array(0)).encrypt(z);
      kNew.set(ct);
      return kNew.subarray(0, keyLen);
    }
  };
})();
// node_modules/@lukeburns/clatterjs/dist/noiseNq.js
function noiseIk() {
  return new HandshakePattern("IK", [], [1], [
    [0, 3, 1, 5]
  ], [[0, 2, 4]]);
}
// packages/crypto/dist/noise.js
var NOISE_IK_PROTOCOL = "Noise_IK_25519_ChaChaPoly_SHA256";

class NoiseIkSession {
  handshake;
  expectedRemoteStatic;
  transport;
  destroyed = false;
  constructor(options) {
    const localPrivate = requireKey(options.localPrivateKey, "local private key");
    const localPublic = requireKey(options.localPublicKey, "local public key");
    this.expectedRemoteStatic = requireKey(options.remotePublicKey, "remote public key");
    const initiator = options.role === "initiator";
    this.handshake = new NqHandshake(noiseIk(), {
      prologue: Uint8Array.from(options.prologue),
      initiator,
      s: { secretKey: localPrivate, publicKey: localPublic },
      ...initiator ? { rs: Uint8Array.from(this.expectedRemoteStatic) } : {},
      cipher: chachaPoly,
      hash: sha256H,
      rng: options.random ?? randomBytes2
    });
    if (this.handshake.getName() !== NOISE_IK_PROTOCOL) {
      throw new NoiseSessionError("NOISE_SUITE_MISMATCH", "The Noise provider selected an unexpected cipher suite.");
    }
  }
  get protocol() {
    return NOISE_IK_PROTOCOL;
  }
  get complete() {
    return this.transport !== undefined;
  }
  get canWriteHandshake() {
    this.assertLive();
    return !this.complete && this.handshake.isWriteTurn();
  }
  writeHandshake(payload = new Uint8Array) {
    this.assertHandshake(false);
    const output = new Uint8Array(payload.byteLength + this.handshake.getNextMessageOverhead());
    const length = this.handshake.writeMessage(payload, output);
    this.finishIfReady();
    return output.slice(0, length);
  }
  readHandshake(message) {
    this.assertHandshake(true);
    const output = new Uint8Array(message.byteLength);
    const length = this.handshake.readMessage(message, output);
    this.verifyRemoteStatic();
    this.finishIfReady();
    return output.slice(0, length);
  }
  encrypt(plaintext) {
    this.assertLive();
    if (this.transport === undefined)
      throw new NoiseSessionError("NOISE_NOT_READY", "The Noise handshake is not complete.");
    return this.transport.sendVec(plaintext);
  }
  decrypt(ciphertext) {
    this.assertLive();
    if (this.transport === undefined)
      throw new NoiseSessionError("NOISE_NOT_READY", "The Noise handshake is not complete.");
    return this.transport.receiveVec(ciphertext);
  }
  sendingCounter() {
    if (this.transport === undefined)
      return 0n;
    return this.transport.sendingNonce();
  }
  receivingCounter() {
    if (this.transport === undefined)
      return 0n;
    return this.transport.receivingNonce();
  }
  destroy() {
    if (this.destroyed)
      return;
    this.destroyed = true;
    this.expectedRemoteStatic.fill(0);
    this.transport = undefined;
    this.handshake = undefined;
  }
  finishIfReady() {
    if (!this.handshake.isFinished())
      return;
    this.verifyRemoteStatic();
    this.transport = this.handshake.finalize();
  }
  verifyRemoteStatic() {
    const actual = this.handshake.getRemoteStatic();
    if (actual === undefined || !constantTimeEqual(actual, this.expectedRemoteStatic)) {
      this.destroy();
      throw new NoiseSessionError("PEER_IDENTITY_MISMATCH", "The Noise peer static key does not match local trust.");
    }
  }
  assertHandshake(reading) {
    this.assertLive();
    if (this.complete)
      throw new NoiseSessionError("NOISE_ALREADY_READY", "The Noise handshake is already complete.");
    if (this.handshake.isWriteTurn() === reading) {
      throw new NoiseSessionError("NOISE_HANDSHAKE_ORDER", "The Noise handshake message arrived out of order.");
    }
  }
  assertLive() {
    if (this.destroyed)
      throw new NoiseSessionError("NOISE_DESTROYED", "The Noise session is closed.");
  }
}

class NoiseSessionError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function createNoisePrologue(connectionId, hostDeviceId, clientDeviceId) {
  for (const [name, value] of Object.entries({ connectionId, hostDeviceId, clientDeviceId })) {
    if (value.length === 0 || value.includes("\x00"))
      throw new TypeError(`${name} is not safe for a Noise prologue`);
  }
  return new TextEncoder().encode(`DSH-REMOTE\x00v=1\x00connection=${connectionId}\x00host=${hostDeviceId}\x00client=${clientDeviceId}`);
}
function requireKey(value, label) {
  const key = fromBase64Url(value);
  if (key.byteLength !== 32)
    throw new NoiseSessionError("INVALID_KEY", `${label} must be a 32-byte X25519 key.`);
  return Uint8Array.from(key);
}
function constantTimeEqual(left, right) {
  if (left.byteLength !== right.byteLength)
    return false;
  let different = 0;
  for (let index = 0;index < left.byteLength; index += 1)
    different |= left[index] ^ right[index];
  return different === 0;
}

// packages/crypto/dist/index.js
function generateKeyPair(privateKeyBytes) {
  const privateKey = privateKeyBytes ?? x25519.utils.randomPrivateKey();
  if (privateKey.byteLength !== 32)
    throw new Error("X25519 private keys must be 32 bytes");
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    privateKey: toBase64Url(privateKey),
    publicKey: toBase64Url(publicKey)
  };
}
function toBase64Url(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function fromBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof atob === "function") {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

// packages/protocol/dist/loopback.js
var LOOPBACK_CHUNK_BYTES = 64 * 1024;
var LOOPBACK_MAX_BODY_BYTES = 1024 * 1024;
var LOOPBACK_MAX_WS_BYTES = 256 * 1024;
var id = string2().uuid();
var data = string2().max(Math.ceil(LOOPBACK_MAX_BODY_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
var target = {
  port: number2().int().min(1024).max(65535),
  path: string2().min(1).max(8192).regex(/^\/(?!\/)[^\x00-\x20\x7f\\]*$/),
  headers: array(tuple([string2().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/), string2().max(8192).regex(/^[^\x00-\x08\x0a-\x1f\x7f]*$/)])).max(64)
};
var loopbackRequestSchema = discriminatedUnion("op", [
  object({ op: literal("describe") }).strict(),
  object({ op: literal("http.open"), id, ...target, method: _enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]), body: data.optional() }).strict(),
  object({ op: literal("http.read"), id }).strict(),
  object({ op: literal("close"), id }).strict(),
  object({ op: literal("ws.open"), id, ...target, protocols: array(string2().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/)).max(16) }).strict(),
  object({ op: literal("ws.read"), id }).strict(),
  object({ op: literal("ws.send"), id, data, binary: boolean2() }).strict()
]);
// packages/protocol/dist/wire-json.js
function parseWireJson(input) {
  try {
    const text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
    const value = JSON.parse(text);
    const objects = [];
    for (let index = 0;index < text.length; index += 1) {
      const char = text[index];
      if (char === "{")
        objects.push(new Set);
      else if (char === "[")
        objects.push(undefined);
      else if (char === "}" || char === "]")
        objects.pop();
      else if (char === '"') {
        const start = index;
        for (index += 1;index < text.length; index += 1) {
          if (text[index] === "\\")
            index += 1;
          else if (text[index] === '"')
            break;
        }
        let next = index + 1;
        while (next < text.length && /\s/u.test(text[next]))
          next += 1;
        if (text[next] !== ":")
          continue;
        const keys = objects[objects.length - 1];
        const key = JSON.parse(text.slice(start, index + 1));
        if (keys.has(key))
          throw new Error("Duplicate JSON field.");
        keys.add(key);
      }
    }
    return value;
  } catch {
    throw new Error("Invalid wire JSON.");
  }
}
// packages/protocol/dist/close-semantics.js
var SERVER_SHUTDOWN_REASON = "server shutdown";
var SERVER_SHUTDOWN_CLOSE_CODES = [4009, 4001, 1013];
var HEARTBEAT_TIMEOUT_CLOSE_CODE = 4009;
var HEARTBEAT_TIMEOUT_REASON = "heartbeat timeout";
var HEARTBEAT_CONNECTION_FAILED_REASON = "CONNECTION_FAILED";
var TRANSIENT_CONTROL_CLOSE_CODES = [1000, 1001, 1006, 1011, 1012, 1013];
function normalizeReason(reason) {
  return typeof reason === "string" ? reason.trim() : "";
}
function isServerShutdownClose(code, reason) {
  return SERVER_SHUTDOWN_CLOSE_CODES.includes(code) && normalizeReason(reason) === SERVER_SHUTDOWN_REASON;
}
function isHeartbeatTimeoutClose(code, reason) {
  return code === HEARTBEAT_TIMEOUT_CLOSE_CODE && normalizeReason(reason) === HEARTBEAT_TIMEOUT_REASON || code === 4001 && normalizeReason(reason) === HEARTBEAT_CONNECTION_FAILED_REASON;
}
function classifyControlClose(code, reason) {
  const serverShutdown = isServerShutdownClose(code, reason);
  const heartbeatTimeout = isHeartbeatTimeoutClose(code, reason);
  const replaced = code === 4003;
  return {
    serverShutdown,
    heartbeatTimeout,
    retryable: serverShutdown || heartbeatTimeout || TRANSIENT_CONTROL_CLOSE_CODES.includes(code),
    replaced
  };
}

// packages/protocol/dist/index.js
var WEBRTC_RESUME_CAPABILITY = "transport.webrtc.resume.v1";
var RELAY_RESUME_CAPABILITY = "transport.relay.resume.v1";
var WEBRTC_LEASE_MS = 300000;
var PROTOCOL_VERSION = 1;
var MAX_CONTROL_FRAME_BYTES = 64 * 1024;
var MAX_RELAY_FRAME_BYTES = 1024 * 1024;
var SECURE_FRAGMENT_CHUNK_BYTES = 48 * 1024;
var MAX_SECURE_MESSAGE_BYTES = 4 * 1024 * 1024;
var HARNESS_API_TRANSFER_CHUNK_BYTES = 512 * 1024;
var CODEX_APP_TRANSFER_CHUNK_BYTES = 512 * 1024;
var AGENT_ACP_TRANSFER_CHUNK_BYTES = 512 * 1024;
var MAX_HARNESS_API_TRANSFER_BYTES = 288 * 1024 * 1024;
var MAX_CODEX_APP_TRANSFER_BYTES = 288 * 1024 * 1024;
var MAX_AGENT_ACP_TRANSFER_BYTES = 288 * 1024 * 1024;
var MAX_DEVICE_NAME_LENGTH = 128;
var MAX_DEVICE_PLATFORM_LENGTH = 64;
var MAX_DEVICE_VERSION_LENGTH = 64;
var MAX_AUTH_TOKEN_LENGTH = 8 * 1024;
var MAX_REMOTE_CAPABILITY_ENTRIES = 128;
var MAX_REMOTE_WORKSPACE_TYPE_ENTRIES = 32;
var HOST_REGISTRATION_CODE_TTL_MS = 10 * 60000;
var DEFAULT_HEARTBEAT_INTERVAL_MS = 25000;
var TRANSFER_IDLE_MS = 2 * 60000;
var MAX_RPC_TEXT_INPUT_BYTES = 64 * 1024;
var MAX_FILEVIEWER_RANGE_BYTES = 512 * 1024;
var MIN_REPLAY_WINDOW_MS = 15 * 60000;
var MAX_ACP_PROMPT_BYTES = 64 * 1024;
var MAX_ACP_UPDATE_BYTES = 512 * 1024;
var SECURE_FRAGMENT_MAGIC = new Uint8Array([68, 83, 72, 70]);
var SECURE_FRAGMENT_VERSION = 1;
var SECURE_FRAGMENT_HEADER_BYTES = 17;
var MAX_IN_FLIGHT_SECURE_MESSAGES = 8;
var messageTypes = [
  "rpc.request",
  "rpc.response",
  "rpc.error",
  "event"
];
var controlFrameTypes = [
  "hello",
  "hello.ack",
  "connect.request",
  "connect.incoming",
  "connect.accepted",
  "connect.rejected",
  "secure.handshake",
  "relay",
  "signal.offer",
  "signal.answer",
  "signal.ice",
  "transport.selected",
  "connection.lease.request",
  "connection.lease.ack",
  "connection.lease.close",
  "ping",
  "pong",
  "error"
];
var rpcMethods = [
  "workspace.upload.open",
  "workspace.upload.chunk",
  "workspace.upload.commit",
  "workspace.upload.abort",
  "harness.transport.describe",
  "remote.history.configure",
  "harness.api.call",
  "harness.api.transfer.open",
  "harness.api.transfer.chunk",
  "harness.api.transfer.commit",
  "harness.api.transfer.read",
  "harness.api.transfer.close",
  "harness.api.respond",
  "harness.api.stream.open",
  "harness.api.stream.close",
  "harness.remote.call",
  "harness.remote.transfer.open",
  "harness.remote.transfer.chunk",
  "harness.remote.transfer.commit",
  "harness.remote.transfer.read",
  "harness.remote.transfer.close",
  "harness.remote.stream.open",
  "harness.remote.stream.close",
  "harness.remote.compaction.submit",
  "harness.remote.compaction.status",
  "harness.remote.compaction.cancel",
  "loopback.call",
  "fileviewer.call",
  "codex.app.call",
  "codex.app.respond",
  "codex.app.stream.open",
  "codex.app.stream.close",
  "codex.app.transfer.open",
  "codex.app.transfer.chunk",
  "codex.app.transfer.commit",
  "codex.app.transfer.read",
  "codex.app.transfer.close",
  "agent.acp.call",
  "agent.acp.respond",
  "agent.acp.stream.open",
  "agent.acp.stream.close",
  "agent.acp.transfer.open",
  "agent.acp.transfer.chunk",
  "agent.acp.transfer.commit",
  "agent.acp.transfer.read",
  "agent.acp.transfer.close",
  "acp.initialize",
  "acp.session.new",
  "acp.session.load",
  "acp.session.prompt",
  "acp.session.respond_permission",
  "acp.session.cancel",
  "acp.session.set_mode",
  "plugin.route.call"
];
var errorCodes = [
  "INVALID_MESSAGE",
  "UNSUPPORTED_VERSION",
  "CAPABILITY_NOT_SUPPORTED",
  "METHOD_NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "REQUEST_CONFLICT",
  "FRAME_TOO_LARGE",
  "RATE_LIMITED",
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "ACCOUNT_AUTH_REQUIRED",
  "TOKEN_EXPIRED",
  "DEVICE_NOT_FOUND",
  "DEVICE_REVOKED",
  "DEVICE_OWNERSHIP_REQUIRED",
  "MEMBERSHIP_REQUIRED",
  "PEER_IDENTITY_MISMATCH",
  "HOST_REGISTRATION_CODE_NOT_FOUND",
  "HOST_REGISTRATION_CODE_EXPIRED",
  "HOST_REGISTRATION_CODE_CONSUMED",
  "HOST_OFFLINE",
  "CONNECTION_NOT_FOUND",
  "CONNECTION_FAILED",
  "CONNECTION_REPLACED",
  "P2P_FAILED",
  "TURN_UNAVAILABLE",
  "RELAY_UNAVAILABLE",
  "SLOW_CONSUMER",
  "SECURE_CHANNEL_FAILED",
  "HARNESS_UNAVAILABLE",
  "HARNESS_VERSION_INCOMPATIBLE",
  "RESPONSE_TOO_LARGE",
  "SESSION_NOT_FOUND",
  "SESSION_NOT_READY",
  "AGENT_BUSY",
  "PERMISSION_DENIED",
  "PERMISSION_NOT_PENDING",
  "RPC_TIMEOUT",
  "FULL_RESYNC_REQUIRED",
  "INTERNAL_ERROR"
];
var selectedTransports = ["lan", "p2p", "turn", "relay"];
function normalizeSdpMLineIndex(value) {
  if (value === undefined)
    return;
  if (value === null)
    return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    return null;
  return value;
}
function selectCapabilities(offered, supported) {
  const offeredCapabilities = new Set(offered);
  return [...new Set(supported)].filter((capability) => offeredCapabilities.has(capability));
}
function acceptNegotiatedCapabilities(offered, negotiated) {
  const accepted = negotiated ?? ["transport.relay"];
  if (selectCapabilities(accepted, offered).length !== accepted.length) {
    throw new Error("Server selected a capability that the peer did not offer.");
  }
  return [...accepted];
}
var rpcMethodSchema = _enum(rpcMethods);
var messageTypeSchema = _enum(messageTypes);
var controlFrameTypeSchema = _enum(controlFrameTypes);
var errorCodeSchema = _enum(errorCodes);
var uniqueStrings = (values) => new Set(values).size === values.length;
var uniqueNumbers = (values) => new Set(values).size === values.length;
var utf8Length = (value) => new TextEncoder().encode(value).byteLength;
var boundedUtf8Schema = (minimum, maximum) => string2().refine((value) => utf8Length(value) >= minimum && utf8Length(value) <= maximum);
var deviceIdSchema = string2().refine((value) => /^[0-9A-HJKMNP-TV-Z]{26}$/iu.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value), "Device ID must be a ULID or UUID.");
var deviceNameSchema = boundedUtf8Schema(1, MAX_DEVICE_NAME_LENGTH).refine((value) => value.trim().length > 0, "Device name must contain visible text.");
var devicePlatformSchema = string2().min(1).max(MAX_DEVICE_PLATFORM_LENGTH).regex(/^[a-z0-9][a-z0-9._-]*$/u);
var identityKeySchema = string2().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
var canonicalBase64UrlSchema = string2().min(1).regex(/^[A-Za-z0-9_-]+$/u).refine((value) => {
  const remainder = value.length % 4;
  if (remainder === 1)
    return false;
  if (remainder === 0)
    return true;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(value.at(-1));
  return remainder === 2 ? (last & 15) === 0 : (last & 3) === 0;
}, "Value must use canonical Base64URL without padding.");
var deviceVersionSchema = boundedUtf8Schema(1, MAX_DEVICE_VERSION_LENGTH);
var authTokenSchema = boundedUtf8Schema(16, MAX_AUTH_TOKEN_LENGTH);
var expiresAtSchema = number2().int().positive().safe();
var hostDeviceDescriptorSchema = object({
  deviceId: deviceIdSchema,
  name: deviceNameSchema,
  role: literal("host"),
  platform: devicePlatformSchema,
  identityKey: identityKeySchema,
  clientVersion: deviceVersionSchema,
  harnessVersion: deviceVersionSchema.optional()
}).strict();
var clientDeviceDescriptorSchema = object({
  deviceId: deviceIdSchema,
  name: deviceNameSchema,
  role: literal("client"),
  platform: devicePlatformSchema,
  identityKey: identityKeySchema,
  clientVersion: deviceVersionSchema
}).strict();
var accountDeviceDescriptorSchema = union([
  hostDeviceDescriptorSchema,
  clientDeviceDescriptorSchema
]);
var deviceRegistrationRequestSchema = object({
  v: literal(PROTOCOL_VERSION),
  device: accountDeviceDescriptorSchema
}).strict();
var hostRegistrationCodeRequestSchema = object({
  v: literal(PROTOCOL_VERSION),
  code: string2().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/u),
  device: hostDeviceDescriptorSchema
}).strict();
var registerOwnedRoleRequestSchema = object({
  v: literal(PROTOCOL_VERSION),
  device: accountDeviceDescriptorSchema
}).strict();
var deviceRefreshRequestSchema = object({
  deviceId: deviceIdSchema,
  refreshToken: authTokenSchema
}).strict();
var deviceTokenPairSchema = object({
  accessToken: authTokenSchema,
  accessTokenExpiresAt: expiresAtSchema,
  refreshToken: authTokenSchema,
  refreshTokenExpiresAt: expiresAtSchema
}).strict();
var browserAuthorizationExchangeRequestSchema = object({
  v: literal(PROTOCOL_VERSION),
  device: object({
    deviceId: deviceIdSchema,
    name: deviceNameSchema,
    role: literal("client"),
    platform: literal("browser"),
    identityKey: identityKeySchema,
    clientVersion: deviceVersionSchema
  }).strict()
}).strict();
var browserAuthorizationExchangeResponseSchema = object({
  accessToken: authTokenSchema,
  accessTokenExpiresAt: expiresAtSchema,
  refreshToken: authTokenSchema,
  refreshTokenExpiresAt: expiresAtSchema,
  account: boundedUtf8Schema(1, 254).refine((value) => value.trim().length > 0)
}).strict();
var remoteMessageSchema = object({
  v: literal(PROTOCOL_VERSION),
  id: string2().min(1),
  type: messageTypeSchema,
  timestamp: number2().int().positive(),
  payload: unknown()
});
var controlFrameSchema = object({
  v: literal(PROTOCOL_VERSION),
  id: string2().min(1),
  type: controlFrameTypeSchema,
  timestamp: number2().int().positive(),
  payload: unknown()
}).strict();
var relayDataFrameSchema = object({
  v: literal(PROTOCOL_VERSION),
  id: string2().min(1),
  type: string2().min(1),
  timestamp: number2().int().positive().safe(),
  payload: record(string2(), unknown())
}).strict();
var transportEnum = _enum(["lan", "p2p", "turn", "relay"]);
var selectedTransportEnum = _enum(selectedTransports);
var MAX_PROTOCOL_LIST_ENTRIES = 16;
var MAX_CAPABILITY_ENTRIES = MAX_REMOTE_CAPABILITY_ENTRIES;
var MAX_WORKSPACE_TYPE_ENTRIES = MAX_REMOTE_WORKSPACE_TYPE_ENTRIES;
var MAX_PREFERRED_TRANSPORT_ENTRIES = selectedTransports.length;
var helloPayloadSchema = object({
  recoveryTickets: array(string2().min(1).max(4096)).max(64).optional(),
  role: _enum(["host", "client"]),
  deviceId: string2().min(1),
  accessToken: string2().min(1),
  protocols: array(unknown()).min(1).max(MAX_PROTOCOL_LIST_ENTRIES).pipe(array(number2().int().nonnegative().safe()).refine(uniqueNumbers)),
  capabilities: array(unknown()).max(MAX_CAPABILITY_ENTRIES).pipe(array(string2().min(1)).refine(uniqueStrings)),
  clientVersion: string2().optional(),
  harnessVersion: string2().optional()
});
var helloAckPayloadSchema = object({
  protocol: literal(PROTOCOL_VERSION),
  serverVersion: string2().min(1),
  connectionSessionId: string2().min(1),
  heartbeatIntervalMs: number2().int().positive().safe(),
  maxControlFrameBytes: number2().int().positive().max(MAX_CONTROL_FRAME_BYTES),
  maxRelayFrameBytes: number2().int().positive().max(MAX_RELAY_FRAME_BYTES),
  capabilities: array(unknown()).max(MAX_CAPABILITY_ENTRIES).pipe(array(string2().min(1)).refine(uniqueStrings)).optional(),
  webrtcEnabled: boolean2().optional(),
  webrtcFallbackTimeoutMs: number2().int().positive().safe().optional()
});
var remoteWorkspaceTypeDescriptionSchema = object({
  id: string2().min(1),
  name: string2().min(1),
  capability: string2().min(1),
  available: boolean2()
});
var harnessTransportDescriptionSchema = object({
  capabilities: array(unknown()).max(MAX_CAPABILITY_ENTRIES).pipe(array(string2().min(1)).refine(uniqueStrings)),
  workspaceTypes: array(unknown()).max(MAX_WORKSPACE_TYPE_ENTRIES).pipe(array(remoteWorkspaceTypeDescriptionSchema)).optional()
});
var connectRequestPayloadSchema = object({
  hostDeviceId: string2().min(1),
  preferredTransports: array(unknown()).min(1).max(MAX_PREFERRED_TRANSPORT_ENTRIES).pipe(array(transportEnum))
});
var connectIncomingPayloadSchema = object({
  relayRecoveryTicket: string2().min(1).max(4096).optional(),
  recoveryTicket: string2().min(1).max(4096).optional(),
  connectionId: string2().min(1),
  clientDeviceId: string2().min(1),
  clientIdentityKey: identityKeySchema,
  authorization: literal("account"),
  preferredTransports: array(unknown()).min(1).max(MAX_PREFERRED_TRANSPORT_ENTRIES).pipe(array(transportEnum)),
  relayEndpoint: string2().url().optional(),
  relayTicket: string2().min(1).optional(),
  relayNodeId: string2().min(1).optional(),
  relayEpoch: number2().int().nonnegative().optional()
});
var connectAcceptedPayloadSchema = object({
  relayRecoveryTicket: string2().min(1).max(4096).optional(),
  recoveryTicket: string2().min(1).max(4096).optional(),
  connectionId: string2().min(1),
  relayEndpoint: string2().url().optional(),
  relayTicket: string2().min(1).optional(),
  relayNodeId: string2().min(1).optional(),
  relayEpoch: number2().int().nonnegative().optional()
});
var connectRejectedPayloadSchema = object({
  connectionId: string2().min(1),
  code: string2().optional(),
  message: string2().optional()
});
var secureHandshakePayloadSchema = object({
  connectionId: string2().min(1),
  targetDeviceId: string2().min(1),
  step: union([literal(1), literal(2)]),
  data: canonicalBase64UrlSchema
});
var relayPayloadSchema = object({
  connectionId: string2().min(1),
  targetDeviceId: string2().min(1),
  counter: number2().int().nonnegative().safe(),
  ciphertext: canonicalBase64UrlSchema
});
var signalPayloadSchema = object({
  connectionId: string2().min(1),
  targetDeviceId: string2().min(1),
  sdp: string2().min(1)
});
var signalIcePayloadSchema = object({
  connectionId: string2().min(1),
  targetDeviceId: string2().min(1),
  candidate: object({
    candidate: string2().optional(),
    sdpMid: string2().nullable().optional(),
    sdpMLineIndex: preprocess(normalizeSdpMLineIndex, number2().int().nonnegative().nullable().optional()),
    usernameFragment: string2().nullable().optional()
  })
});
var transportSelectedPayloadSchema = object({
  connectionId: string2().min(1),
  targetDeviceId: string2().min(1),
  transport: selectedTransportEnum,
  turnNode: string2().min(1).max(253).optional()
});
var pingPongPayloadSchema = object({
  nonce: string2().min(1)
});
var controlErrorPayloadSchema = object({
  code: string2().min(1),
  message: string2().min(1),
  retryable: boolean2().optional(),
  connectionId: string2().min(1).optional()
});
var connectionLeaseRequestSchema = object({
  connectionId: string2().min(1).max(128),
  requestId: string2().min(1).max(128),
  ticket: string2().min(1).max(4096)
});
var connectionLeaseAckSchema = connectionLeaseRequestSchema.extend({
  leaseMs: literal(WEBRTC_LEASE_MS)
});
var controlFramePayloadSchemas = {
  hello: helloPayloadSchema,
  "hello.ack": helloAckPayloadSchema,
  "connect.request": connectRequestPayloadSchema,
  "connect.incoming": connectIncomingPayloadSchema,
  "connect.accepted": connectAcceptedPayloadSchema,
  "connect.rejected": connectRejectedPayloadSchema,
  "secure.handshake": secureHandshakePayloadSchema,
  relay: relayPayloadSchema,
  "signal.offer": signalPayloadSchema,
  "signal.answer": signalPayloadSchema,
  "signal.ice": signalIcePayloadSchema,
  "transport.selected": transportSelectedPayloadSchema,
  "connection.lease.request": connectionLeaseRequestSchema,
  "connection.lease.ack": connectionLeaseAckSchema,
  "connection.lease.close": object({ connectionId: string2().min(1).max(128) }),
  ping: pingPongPayloadSchema,
  pong: pingPongPayloadSchema,
  error: controlErrorPayloadSchema
};
var rpcRequestPayloadSchema = object({
  method: rpcMethodSchema,
  params: unknown()
});
var rpcResponsePayloadSchema = object({
  requestId: string2().min(1),
  result: unknown()
});
var rpcErrorPayloadSchema = object({
  requestId: string2().min(1),
  code: string2().min(1),
  message: string2().min(1),
  retryable: boolean2().optional(),
  details: unknown().optional()
});
function createMessage(type, payload, id = cryptoRandomId()) {
  return {
    v: PROTOCOL_VERSION,
    id,
    type,
    timestamp: Date.now(),
    payload
  };
}
function createControlFrame(type, payload, id = cryptoRandomId()) {
  return {
    v: PROTOCOL_VERSION,
    id,
    type,
    timestamp: Date.now(),
    payload
  };
}
function createRelayDataFrame(type, payload, id = cryptoRandomId()) {
  return {
    v: PROTOCOL_VERSION,
    id,
    type,
    timestamp: Date.now(),
    payload
  };
}
function createRpcResponse(requestId, result) {
  return createMessage("rpc.response", { requestId, result });
}
function createRpcError(requestId, code, message, details, retryable) {
  return createMessage("rpc.error", { requestId, code, message, details, retryable });
}
function createEvent(event, data, options = {}) {
  return createMessage("event", { event, data, ...options });
}
function parseRemoteMessage(input) {
  return remoteMessageSchema.parse(input);
}
function parseControlFrame(input) {
  const frame = controlFrameSchema.parse(input);
  const payloadSchema = controlFramePayloadSchemas[frame.type];
  if (payloadSchema) {
    return { ...frame, payload: payloadSchema.parse(frame.payload) };
  }
  return frame;
}
function encodeControlFrame(frame, limits = {}) {
  const parsed = parseControlFrame(frame);
  const encoded = JSON.stringify(parsed);
  assertControlFrameSize(new TextEncoder().encode(encoded).byteLength, parsed.type, limits);
  return encoded;
}
function decodeControlFrame(data, limits = {}) {
  const encoded = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (encoded.byteLength > MAX_RELAY_FRAME_BYTES)
    throw new Error("Control frame exceeds the Relay frame limit.");
  const frame = parseControlFrame(parseWireJson(data));
  assertControlFrameSize(encoded.byteLength, frame.type, limits);
  return frame;
}
function encodeRelayDataFrame(frame, limits = {}) {
  const parsed = parseRelayDataFrame(frame);
  const encoded = JSON.stringify(parsed);
  assertControlFrameSize(new TextEncoder().encode(encoded).byteLength, "relay", limits);
  return encoded;
}
function decodeRelayDataFrame(data, limits = {}) {
  const encoded = typeof data === "string" ? new TextEncoder().encode(data) : data;
  assertControlFrameSize(encoded.byteLength, "relay", limits);
  try {
    return parseRelayDataFrame(parseWireJson(data));
  } catch {
    throw new Error("Invalid Relay data frame.");
  }
}
function parseRelayDataFrame(input) {
  const frame = relayDataFrameSchema.parse(input);
  if (frame.type === "relay")
    return { ...frame, payload: relayPayloadSchema.parse(frame.payload) };
  if (frame.type === "secure.handshake")
    return { ...frame, payload: secureHandshakePayloadSchema.parse(frame.payload) };
  return frame;
}
function encodeMessage(message) {
  return new TextEncoder().encode(JSON.stringify(message));
}
function decodeMessage(data) {
  return parseRemoteMessage(parseWireJson(data));
}

class SecureMessageCodec {
  nextMessageId = 1;
  assemblies = new Map;
  encode(message) {
    if (message.byteLength > MAX_SECURE_MESSAGE_BYTES) {
      throw new Error("Secure message exceeds the reassembly limit.");
    }
    if (message.byteLength <= SECURE_FRAGMENT_CHUNK_BYTES)
      return [message];
    const messageId = this.nextMessageId;
    this.nextMessageId = messageId === 4294967295 ? 1 : messageId + 1;
    const total = Math.ceil(message.byteLength / SECURE_FRAGMENT_CHUNK_BYTES);
    const frames = [];
    for (let index = 0;index < total; index += 1) {
      const start = index * SECURE_FRAGMENT_CHUNK_BYTES;
      const chunk = message.subarray(start, Math.min(message.byteLength, start + SECURE_FRAGMENT_CHUNK_BYTES));
      const frame = new Uint8Array(SECURE_FRAGMENT_HEADER_BYTES + chunk.byteLength);
      frame.set(SECURE_FRAGMENT_MAGIC);
      frame[4] = SECURE_FRAGMENT_VERSION;
      const view = new DataView(frame.buffer);
      view.setUint32(5, messageId);
      view.setUint16(9, index);
      view.setUint16(11, total);
      view.setUint32(13, message.byteLength);
      frame.set(chunk, SECURE_FRAGMENT_HEADER_BYTES);
      frames.push(frame);
    }
    return frames;
  }
  decode(frame) {
    if (!isSecureFragment(frame))
      return frame;
    if (frame.byteLength < SECURE_FRAGMENT_HEADER_BYTES || frame[4] !== SECURE_FRAGMENT_VERSION) {
      throw new Error("Secure fragment header is invalid.");
    }
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const messageId = view.getUint32(5);
    const index = view.getUint16(9);
    const total = view.getUint16(11);
    const totalBytes = view.getUint32(13);
    if (messageId === 0 || total < 2 || index >= total || totalBytes <= SECURE_FRAGMENT_CHUNK_BYTES || totalBytes > MAX_SECURE_MESSAGE_BYTES || total !== Math.ceil(totalBytes / SECURE_FRAGMENT_CHUNK_BYTES)) {
      throw new Error("Secure fragment metadata is invalid.");
    }
    const expectedChunkBytes = Math.min(SECURE_FRAGMENT_CHUNK_BYTES, totalBytes - index * SECURE_FRAGMENT_CHUNK_BYTES);
    const chunk = frame.subarray(SECURE_FRAGMENT_HEADER_BYTES);
    if (chunk.byteLength !== expectedChunkBytes)
      throw new Error("Secure fragment length is invalid.");
    let assembly = this.assemblies.get(messageId);
    if (assembly === undefined) {
      if (index !== 0 || this.assemblies.size >= MAX_IN_FLIGHT_SECURE_MESSAGES) {
        throw new Error("Secure fragment sequence is invalid.");
      }
      assembly = { total, totalBytes, receivedBytes: 0, chunks: [] };
      this.assemblies.set(messageId, assembly);
    }
    if (assembly.total !== total || assembly.totalBytes !== totalBytes || index !== assembly.chunks.length) {
      this.assemblies.delete(messageId);
      throw new Error("Secure fragment sequence is invalid.");
    }
    assembly.chunks.push(Uint8Array.from(chunk));
    assembly.receivedBytes += chunk.byteLength;
    if (assembly.chunks.length < total)
      return;
    this.assemblies.delete(messageId);
    if (assembly.receivedBytes !== totalBytes)
      throw new Error("Secure message length is invalid.");
    const message = new Uint8Array(totalBytes);
    let offset = 0;
    for (const part of assembly.chunks) {
      message.set(part, offset);
      offset += part.byteLength;
    }
    return message;
  }
  reset() {
    this.nextMessageId = 1;
    this.assemblies.clear();
  }
}
function isSecureFragment(frame) {
  if (frame.byteLength < SECURE_FRAGMENT_MAGIC.byteLength)
    return false;
  for (let index = 0;index < SECURE_FRAGMENT_MAGIC.byteLength; index += 1) {
    if (frame[index] !== SECURE_FRAGMENT_MAGIC[index])
      return false;
  }
  return true;
}
function assertControlFrameSize(bytes, type, limits) {
  const configured = type === "relay" ? limits.maxRelayFrameBytes : limits.maxControlFrameBytes;
  const protocolMaximum = type === "relay" ? MAX_RELAY_FRAME_BYTES : MAX_CONTROL_FRAME_BYTES;
  const maximum = configured === undefined ? protocolMaximum : Math.min(protocolMaximum, configured);
  if (!Number.isSafeInteger(maximum) || maximum <= 0)
    throw new Error("Control frame limit is invalid.");
  if (bytes > maximum)
    throw new Error(`${type === "relay" ? "Relay" : "Control"} frame exceeds its limit.`);
}
function cryptoRandomId() {
  const g = globalThis.crypto;
  if (g?.randomUUID)
    return g.randomUUID();
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

// packages/plugin/src/version.ts
var PLUGIN_VERSION = "0.6.5";

// packages/plugin/src/server-api.ts
var TERMINAL_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

class HostServerApi {
  store;
  fetchImplementation;
  role;
  baseUrl;
  hostOnly = false;
  identity;
  credentials;
  credentialsPromise;
  harnessVersion;
  lifetime = new AbortController;
  constructor(serverUrl, store, fetchImplementation = fetch, role = "host", httpServerAllowlist = []) {
    this.store = store;
    this.fetchImplementation = fetchImplementation;
    this.role = role;
    this.baseUrl = normalizeServerUrl(serverUrl, httpServerAllowlist);
  }
  bindIdentity(identity) {
    this.identity = identity;
  }
  setHarnessVersion(version) {
    this.harnessVersion = version;
  }
  close() {
    this.lifetime.abort(new ServerApiError("CONNECTION_CLOSED", "The Server API has been closed.", false));
  }
  pairingHostOnly() {
    return this.hostOnly;
  }
  async loadStoredPolicy() {
    this.hostOnly = this.role === "host" && (await this.store.pairingHostOnly() || (await this.store.load(this.baseUrl, this.requireIdentity().deviceId))?.pairingRestricted === true);
  }
  async adoptPairing(result) {
    const identity = this.requireIdentity();
    if (this.role !== "host" || result.device.role !== "host" || result.device.deviceId !== identity.deviceId || result.device.identityKey !== identity.publicKey)
      throw new ServerApiError("PAIRING_IDENTITY_INVALID", "Pairing identity mismatch.", false);
    if (result.pairingRestricted) {
      if (!result.inboundOnly)
        throw new ServerApiError("DEVICE_SCOPE_REQUIRED", "Paired Host must remain inbound only.", false);
      this.hostOnly = true;
      await this.store.restrictPairingHostOnly();
    }
    this.credentials = await this.withRefreshLock(async () => {
      const existing = await this.store.load(this.baseUrl, identity.deviceId);
      if (existing?.account !== undefined && existing.account !== result.account)
        throw new ServerApiError("PAIRING_ACCOUNT_CONFLICT", "Pairing cannot replace the current account.", false);
      if (existing !== undefined && existing.refreshTokenExpiresAt > Date.now() + 30000)
        return existing;
      return this.store.save({
        serverUrl: this.baseUrl,
        deviceId: identity.deviceId,
        authorizationMethod: "device_pairing",
        account: result.account,
        accountKind: result.accountKind,
        pairingRestricted: result.pairingRestricted,
        inboundOnly: result.inboundOnly,
        ...validateTokens(result.tokens)
      });
    });
  }
  currentAuthorization() {
    if (this.credentials === undefined)
      return;
    return {
      method: this.credentials.authorizationMethod,
      ...this.credentials.account === undefined ? {} : { account: this.credentials.account }
    };
  }
  async hasStoredAuthorization() {
    const identity = this.requireIdentity();
    return await this.store.load(this.baseUrl, identity.deviceId) !== undefined;
  }
  async clearAuthorization() {
    this.credentials = undefined;
    this.credentialsPromise = undefined;
    await this.store.clear();
  }
  async revokeCurrentDevice() {
    const identity = this.requireIdentity();
    if (await this.store.load(this.baseUrl, identity.deviceId) === undefined) {
      await this.clearAuthorization();
      return;
    }
    try {
      await this.request("/api/v1/devices/self", { method: "DELETE" });
    } finally {
      await this.clearAuthorization();
    }
  }
  async authorizeWithAccount(identity, email, password, recoverIdentity) {
    this.bindIdentity(identity);
    const account = email.trim();
    if (account.length === 0 || password.length === 0) {
      throw new ServerApiError("INVALID_MESSAGE", "Email and password are required.", false);
    }
    const login = validateWebLogin(await this.publicRequest("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: account, password })
    }));
    const authorization = {
      accountToken: login.token,
      account: login.account,
      authorizationMethod: "account"
    };
    try {
      await this.register(identity, authorization);
    } catch (error) {
      if (!(error instanceof ServerApiError) || error.code !== "DEVICE_REVOKED" || recoverIdentity === undefined)
        throw error;
      const nextIdentity = await recoverIdentity();
      this.bindIdentity(nextIdentity);
      await this.register(nextIdentity, authorization);
    }
    return {
      method: "account",
      account: login.account,
      expiresAt: login.expiresAt,
      isAdmin: login.isAdmin
    };
  }
  async oauthProviders() {
    let body;
    try {
      body = await this.publicRequest("/api/v1/auth/oauth/providers", { method: "GET" });
    } catch (error) {
      if (!(error instanceof ServerApiError) || error.status !== 404)
        throw error;
      const legacy = [
        { id: "zhihu", displayName: "Zhihu", startUrl: "/api/v1/auth/oauth/start", statusUrl: "/api/v1/auth/oauth/status" },
        { id: "github", displayName: "GitHub", startUrl: "/api/v1/auth/oauth/github/start", statusUrl: "/api/v1/auth/oauth/github/status" }
      ];
      const items = await Promise.all(legacy.map(async ({ statusUrl, ...provider }) => {
        try {
          const status = requireRecord(await this.publicRequest(statusUrl, { method: "GET" }), "OAuth status");
          if (typeof status.configured !== "boolean")
            throw invalidOAuthProviders();
          return status.configured ? [{ ...provider, qrStartUrl: `/api/v1/auth/oauth/qr/start?provider=${provider.id}` }] : [];
        } catch (reason) {
          if (reason instanceof ServerApiError && reason.status === 404)
            return [];
          throw reason;
        }
      }));
      return items.flat();
    }
    const value = requireRecord(body, "OAuth providers");
    if (!Array.isArray(value.items))
      throw invalidOAuthProviders();
    const ids = new Set;
    const providers = value.items.map((item) => {
      const provider = requireRecord(item, "OAuth provider");
      if (typeof provider.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(provider.id) || ids.has(provider.id) || typeof provider.displayName !== "string" || !provider.displayName.trim() || provider.displayName.length > 128 || TERMINAL_CONTROL_CHARACTERS.test(provider.displayName) || !isOAuthEntryPath(provider.startUrl) || provider.qrStartUrl != null && !isOAuthEntryPath(provider.qrStartUrl))
        throw invalidOAuthProviders();
      ids.add(provider.id);
      return {
        id: provider.id,
        displayName: provider.displayName,
        startUrl: provider.startUrl,
        ...typeof provider.qrStartUrl === "string" ? { qrStartUrl: provider.qrStartUrl } : {}
      };
    });
    const capabilities = value.capabilities;
    if (typeof capabilities === "object" && capabilities !== null && capabilities.devicePairing === "dsh-pairing-v1") {
      providers.push({ id: "dsh-go-pairing-v1", displayName: "DSH-Go", startUrl: "/api/v1/device-pairing", devicePairing: true });
    }
    return providers;
  }
  async startOAuthQrLogin(provider = "zhihu") {
    const entry = (await this.oauthProviders()).find((item) => item.id === provider);
    if (entry?.qrStartUrl == null) {
      throw new ServerApiError("OAUTH_PROVIDER_UNAVAILABLE", "This OAuth provider is unavailable for QR login.", false);
    }
    const value = requireRecord(await this.publicRequest(entry.qrStartUrl, {
      method: "POST",
      body: "{}"
    }), "QR login");
    const scanUrl = normalizeOAuthScanUrl(value.scanUrl, this.baseUrl);
    if (typeof value.qrId !== "string" || value.qrId.length < 20 || scanUrl === undefined || !Number.isSafeInteger(value.expiresIn) || provider !== "zhihu" && value.provider !== provider || value.provider !== undefined && value.provider !== provider) {
      throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid QR login session.", false);
    }
    return { qrId: value.qrId, scanUrl, expiresIn: value.expiresIn };
  }
  async pollOAuthQrLogin(identity, qrId, recoverIdentity) {
    this.bindIdentity(identity);
    const value = requireRecord(await this.publicRequest(`/api/v1/auth/oauth/qr/${encodeURIComponent(qrId)}`, { method: "GET" }), "QR login status");
    if (value.status === "pending" || value.status === "expired")
      return { status: value.status };
    if (value.status !== "complete" || typeof value.token !== "string" || value.token.length < 16) {
      throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid QR login status.", false);
    }
    const account = requireRecord(await this.publicRequest("/api/v1/auth/me", { method: "GET" }, value.token), "account profile");
    if (typeof account.account !== "string" || account.account.length === 0 || typeof account.isAdmin !== "boolean") {
      throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid account profile.", false);
    }
    const authorization = {
      accountToken: value.token,
      account: account.account,
      authorizationMethod: "account"
    };
    try {
      await this.register(identity, authorization);
    } catch (error) {
      if (!(error instanceof ServerApiError) || error.code !== "DEVICE_REVOKED" || recoverIdentity === undefined)
        throw error;
      const nextIdentity = await recoverIdentity();
      this.bindIdentity(nextIdentity);
      await this.register(nextIdentity, authorization);
    }
    return {
      status: "complete",
      authorization: { method: "account", account: account.account, isAdmin: account.isAdmin }
    };
  }
  async authorizeHostWithCode(identity, code) {
    if (this.role !== "host") {
      throw new ServerApiError("METHOD_NOT_ALLOWED", "Host registration codes can only authorize a Host device.", false);
    }
    const registrationCode = code.trim().toUpperCase();
    if (registrationCode.length === 0) {
      throw new ServerApiError("INVALID_MESSAGE", "A Host registration code is required.", false);
    }
    this.bindIdentity(identity);
    const tokens = await this.publicRequest("/api/v1/devices/register-with-code", {
      method: "POST",
      body: JSON.stringify({ v: 1, code: registrationCode, device: this.deviceDescriptor(identity) })
    });
    this.credentials = await this.saveTokens(identity, validateTokens(tokens), {
      authorizationMethod: "host_registration_code"
    });
    return { method: "host_registration_code" };
  }
  async authorizeOwnedRole(identity, authorizingAccessToken, account) {
    this.bindIdentity(identity);
    const tokens = await this.publicRequest("/api/v1/devices/register-owned-role", {
      method: "POST",
      body: JSON.stringify({ v: 1, device: this.deviceDescriptor(identity) })
    }, authorizingAccessToken);
    this.credentials = await this.saveTokens(identity, validateTokens(tokens), {
      authorizationMethod: "owned_device",
      ...account === undefined ? {} : { account }
    });
    return {
      method: "owned_device",
      ...account === undefined ? {} : { account }
    };
  }
  async authenticate(identity = this.requireIdentity()) {
    this.bindIdentity(identity);
    if (this.credentials !== undefined && this.credentials.accessTokenExpiresAt > Date.now() + 30000) {
      return this.credentials;
    }
    this.credentialsPromise ??= this.loadOrIssue(identity).finally(() => {
      this.credentialsPromise = undefined;
    });
    this.credentials = await this.credentialsPromise;
    return this.credentials;
  }
  async refreshCredentials(rejectedAccessToken = this.credentials?.accessToken) {
    const identity = this.requireIdentity();
    this.credentials = await this.withRefreshLock(async () => {
      const stored = await this.store.load(this.baseUrl, identity.deviceId);
      if (stored === undefined || stored.refreshTokenExpiresAt <= Date.now()) {
        if (this.role === "client")
          throw new ServerApiError("ACCOUNT_AUTH_REQUIRED", "Client sign-in is required.", false);
        return this.register(identity);
      }
      if (stored.accessToken !== rejectedAccessToken && stored.accessTokenExpiresAt > Date.now() + 30000) {
        return stored;
      }
      return this.rotateCredentials(identity, stored);
    });
    return this.credentials;
  }
  async withRefreshLock(operation) {
    try {
      return await this.store.withRefreshLock(operation);
    } catch (error) {
      if (error instanceof ServerCredentialsBusyError) {
        throw new ServerApiError(error.code, error.message, true);
      }
      if (error instanceof ServerCredentialsLockUnsupportedError) {
        throw new ServerApiError(error.code, error.message, false);
      }
      throw error;
    }
  }
  async rotateCredentials(identity, stored, allowRecoveredRotation = true) {
    let tokens;
    try {
      tokens = await this.publicRequest("/api/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ deviceId: identity.deviceId, refreshToken: stored.refreshToken })
      });
    } catch (error) {
      if (error instanceof ServerApiError) {
        if (error.code === "AUTH_INVALID" || error.code === "TOKEN_EXPIRED") {
          const latest = await this.store.load(this.baseUrl, identity.deviceId);
          if (latest !== undefined && latest.refreshToken !== stored.refreshToken && latest.refreshTokenExpiresAt > Date.now()) {
            if (latest.accessTokenExpiresAt > Date.now() + 30000)
              return latest;
            if (allowRecoveredRotation)
              return this.rotateCredentials(identity, latest, false);
          }
        }
        throw new ServerApiError(error.code, error.message, error.retryable, error.status, "credential_refresh", error.reason);
      }
      throw error;
    }
    const saved = await this.store.save({
      ...stored,
      ...validateTokens(tokens)
    });
    if (allowRecoveredRotation && saved.accessTokenExpiresAt <= Date.now() + 30000 && saved.refreshToken !== stored.refreshToken && saved.refreshTokenExpiresAt > Date.now()) {
      return this.rotateCredentials(identity, saved, false);
    }
    if (saved.accessTokenExpiresAt <= Date.now()) {
      throw new ServerApiError("CONNECTION_FAILED", "The Server returned an already-expired access token.", true, 200, "credential_refresh");
    }
    return saved;
  }
  async listDevices(signal) {
    const devices = [];
    for await (const page of this.devicePages(signal))
      devices.push(...page);
    return devices;
  }
  async* devicePages(signal) {
    let cursor;
    const cursors = new Set;
    const ids = new Set;
    do {
      signal?.throwIfAborted();
      const query = new URLSearchParams({ limit: "50" });
      if (cursor !== undefined)
        query.set("cursor", cursor);
      const result = await this.request(`/api/v1/devices?${query}`, { signal });
      if (!Array.isArray(result.items))
        throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid device list.", false);
      const page = result.items.map(parseHostDevice);
      const next = result.nextCursor;
      if (next !== undefined && next !== null && (typeof next !== "string" || next.length === 0 || next.length > 512 || cursors.has(next) || page.length === 0)) {
        throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid device list cursor.", false);
      }
      for (const device of page) {
        if (ids.has(device.deviceId))
          throw new ServerApiError("INVALID_MESSAGE", "The Server returned a duplicate device.", false);
        ids.add(device.deviceId);
      }
      cursor = typeof next === "string" ? next : undefined;
      if (cursor !== undefined)
        cursors.add(cursor);
      yield page;
    } while (cursor !== undefined);
  }
  async deviceFor(peerDeviceId, signal) {
    const result = await this.request(`/api/v1/devices/${encodeURIComponent(peerDeviceId)}`, { signal });
    return parseAuthorizedPeer(result);
  }
  async turnCredentials(connectionId) {
    const result = await this.request(`/api/v1/turn/credentials?connection_id=${encodeURIComponent(connectionId)}`);
    if (!Array.isArray(result.iceServers))
      return [];
    return result.iceServers.map(parseIceServer);
  }
  async presenceFor(deviceId, signal) {
    const result = await this.request(`/api/v1/devices/${encodeURIComponent(deviceId)}/presence`, { signal });
    if (typeof result.online !== "boolean" || result.lastSeenAt !== null && result.lastSeenAt !== undefined && !Number.isSafeInteger(result.lastSeenAt)) {
      throw new ServerApiError("INVALID_MESSAGE", "The Server returned invalid device presence.", false);
    }
    return { online: result.online, ...typeof result.lastSeenAt === "number" ? { lastSeenAt: result.lastSeenAt } : {} };
  }
  async loadOrIssue(identity) {
    return this.withRefreshLock(async () => {
      const stored = await this.store.load(this.baseUrl, identity.deviceId);
      if (stored === undefined || stored.refreshTokenExpiresAt <= Date.now() + 30000) {
        return this.register(identity);
      }
      if (stored.accessTokenExpiresAt > Date.now() + 30000)
        return stored;
      return this.rotateCredentials(identity, stored);
    });
  }
  async register(identity, authorization) {
    const tokens = await this.publicRequest("/api/v1/devices/register", {
      method: "POST",
      body: JSON.stringify({
        v: 1,
        device: this.deviceDescriptor(identity)
      })
    }, authorization?.accountToken);
    this.credentials = await this.saveTokens(identity, validateTokens(tokens), {
      authorizationMethod: authorization?.authorizationMethod ?? "account",
      ...authorization?.account === undefined ? {} : { account: authorization.account }
    });
    return this.credentials;
  }
  deviceDescriptor(identity) {
    return {
      deviceId: identity.deviceId,
      name: identity.name,
      role: this.role,
      platform: platform(),
      identityKey: identity.publicKey,
      clientVersion: PLUGIN_VERSION,
      ...this.role === "host" && this.harnessVersion !== undefined ? { harnessVersion: this.harnessVersion } : {}
    };
  }
  saveTokens(identity, tokens, authorization) {
    return this.store.save({
      serverUrl: this.baseUrl,
      deviceId: identity.deviceId,
      authorizationMethod: authorization.authorizationMethod,
      ...authorization.account === undefined ? {} : { account: authorization.account },
      ...tokens
    });
  }
  async request(path, init = {}) {
    const credentials = await this.authenticate();
    try {
      return await this.publicRequest(path, init, credentials.accessToken);
    } catch (error) {
      if (this.identity?.deviceId !== credentials.deviceId || (init.method ?? "GET") !== "GET" || !(error instanceof ServerApiError) || error.status !== 401 || error.code !== "AUTH_INVALID" && error.code !== "TOKEN_EXPIRED")
        throw error;
      init.signal?.throwIfAborted();
      const next = await this.refreshCredentials(credentials.accessToken);
      if (next.account !== credentials.account || this.identity?.deviceId !== credentials.deviceId)
        throw error;
      return this.publicRequest(path, init, next.accessToken);
    }
  }
  async publicRequest(path, init, accessToken) {
    const controller = new AbortController;
    const timer = setTimeout(() => controller.abort(), 1e4);
    const signal = AbortSignal.any([
      this.lifetime.signal,
      controller.signal,
      ...init.signal == null ? [] : [init.signal]
    ]);
    try {
      signal.throwIfAborted();
      const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` },
          ...init.headers
        }
      });
      const body = await parseBody(response);
      signal.throwIfAborted();
      if (!response.ok) {
        const envelope = isErrorEnvelope(body) ? body : undefined;
        if ((response.status === 401 || response.status === 403) && envelope === undefined) {
          throw new ServerApiError("CONNECTION_FAILED", "The Server returned an invalid authorization response.", true, response.status, undefined, "invalid_error_envelope");
        }
        throw new ServerApiError(responseErrorCode(response.status, envelope?.error.code), envelope?.error.message ?? "The Server rejected the request.", envelope?.error.retryable === true || response.status >= 500 || response.status === 429, response.status, undefined, "http_error");
      }
      return body;
    } catch (error) {
      if (this.lifetime.signal.aborted)
        throw this.lifetime.signal.reason;
      if (error instanceof ServerApiError)
        throw error;
      throw new ServerApiError("CONNECTION_FAILED", "Server request failed.", true, undefined, undefined, controller.signal.aborted ? "timeout" : "network_error");
    } finally {
      clearTimeout(timer);
    }
  }
  requireIdentity() {
    if (this.identity === undefined)
      throw new ServerApiError("IDENTITY_INVALID", "The device identity is not loaded.", false);
    return this.identity;
  }
}
function isOAuthEntryPath(value) {
  return typeof value === "string" && /^\/api\/v1\/auth\/[^\s\\#]*$/.test(value) && !TERMINAL_CONTROL_CHARACTERS.test(value) && !value.split("?")[0]?.split("/").some((segment) => segment === "." || segment === ".." || /%/u.test(segment));
}
function invalidOAuthProviders() {
  return new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid OAuth provider list.", false);
}
function normalizeOAuthScanUrl(value, baseUrl) {
  if (typeof value !== "string" || TERMINAL_CONTROL_CHARACTERS.test(value))
    return;
  try {
    const normalized = new URL(value).href;
    return normalized.startsWith(`${baseUrl}/`) ? normalized : undefined;
  } catch {
    return;
  }
}
class ServerApiError extends Error {
  code;
  retryable;
  status;
  phase;
  reason;
  constructor(code, message, retryable, status, phase, reason) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.phase = phase;
    this.reason = reason;
  }
}
function validateTokens(value) {
  const parsed = deviceTokenPairSchema.safeParse(value);
  if (!parsed.success) {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned invalid device credentials.", false);
  }
  return parsed.data;
}
function validateWebLogin(value) {
  const item = requireRecord(value, "account login");
  if (typeof item.token !== "string" || item.token.length < 16 || !Number.isSafeInteger(item.expiresAt) || typeof item.account !== "string" || item.account.length === 0 || item.account.length > 254 || typeof item.isAdmin !== "boolean") {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid account session.", false);
  }
  return {
    token: item.token,
    expiresAt: item.expiresAt,
    account: item.account,
    profile: item.profile,
    isAdmin: item.isAdmin
  };
}
function isErrorEnvelope(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const error = value.error;
  if (typeof error !== "object" || error === null || Array.isArray(error))
    return false;
  const fields = error;
  return typeof fields.code === "string" && fields.code.length > 0 && typeof fields.message === "string" && typeof fields.retryable === "boolean";
}
async function parseBody(response) {
  const text = await response.text();
  if (text.length === 0)
    return;
  try {
    return JSON.parse(text);
  } catch {
    const unstructuredAuth = response.status === 401 || response.status === 403;
    throw new ServerApiError(unstructuredAuth ? "CONNECTION_FAILED" : response.ok ? "INVALID_MESSAGE" : responseErrorCode(response.status, undefined), "The Server returned invalid JSON.", unstructuredAuth || response.ok || response.status >= 500 || response.status === 429, response.status, undefined, "invalid_json");
  }
}
function responseErrorCode(status, serverCode) {
  if (status >= 500)
    return "CONNECTION_FAILED";
  if (status === 429)
    return "RATE_LIMITED";
  if ((status === 401 || status === 403) && typeof serverCode === "string")
    return serverCode;
  if (status === 401 || status === 403)
    return "REQUEST_REJECTED";
  if (typeof serverCode === "string" && !AUTHORIZATION_ERROR_CODES.has(serverCode))
    return serverCode;
  if (status === 404)
    return "DEVICE_NOT_FOUND";
  return "INVALID_MESSAGE";
}
var AUTHORIZATION_ERROR_CODES = new Set([
  "ACCOUNT_AUTH_REQUIRED",
  "AUTH_INVALID",
  "AUTH_REQUIRED",
  "TOKEN_EXPIRED",
  "DEVICE_REVOKED",
  "DEVICE_OWNERSHIP_REQUIRED"
]);
function parseHostDevice(value) {
  const item = requireRecord(value, "host device");
  if (item.role !== "host" || typeof item.deviceId !== "string" || typeof item.name !== "string" || typeof item.platform !== "string" || typeof item.membershipId !== "string" || item.membershipId.length === 0) {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned invalid host device data.", false);
  }
  return {
    deviceId: item.deviceId,
    name: item.name,
    platform: item.platform,
    membershipId: item.membershipId,
    ...typeof item.online === "boolean" ? { online: item.online } : {},
    ...typeof item.lastSeenAt === "number" && Number.isSafeInteger(item.lastSeenAt) ? { lastSeenAt: item.lastSeenAt } : {},
    ...typeof item.clientVersion === "string" ? { clientVersion: item.clientVersion } : {},
    ...typeof item.harnessVersion === "string" ? { harnessVersion: item.harnessVersion } : {}
  };
}
function parseAuthorizedPeer(value) {
  const item = requireRecord(value, "authorized peer");
  if (item.role !== "host" && item.role !== "client" || typeof item.deviceId !== "string" || item.deviceId.length === 0 || typeof item.name !== "string" || item.name.length === 0 || typeof item.platform !== "string" || item.platform.length === 0 || typeof item.identityKey !== "string" || !isIdentityKey(item.identityKey) || typeof item.membershipId !== "string" || item.membershipId.length === 0) {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned invalid authorized peer data.", false);
  }
  return {
    deviceId: item.deviceId,
    name: item.name,
    role: item.role,
    platform: item.platform,
    identityKey: item.identityKey,
    membershipId: item.membershipId,
    ...typeof item.online === "boolean" ? { online: item.online } : {},
    ...typeof item.lastSeenAt === "number" && Number.isSafeInteger(item.lastSeenAt) ? { lastSeenAt: item.lastSeenAt } : {}
  };
}
function parseIceServer(value) {
  const item = requireRecord(value, "ICE server");
  const urls = item.urls;
  if (typeof urls !== "string" && !(Array.isArray(urls) && urls.every((url) => typeof url === "string"))) {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid ICE server.", false);
  }
  return {
    urls,
    ...typeof item.username === "string" ? { username: item.username } : {},
    ...typeof item.credential === "string" ? { credential: item.credential } : {}
  };
}
function isIdentityKey(value) {
  try {
    const decoded = fromBase64Url(value);
    return decoded.length === 32 && toBase64Url(decoded) === value;
  } catch {
    return false;
  }
}
function requireRecord(value, name) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ServerApiError("INVALID_MESSAGE", `The Server returned invalid ${name} data.`, false);
  }
  return value;
}

// packages/plugin/src/pairing-contract.ts
var pairingDeviceSchema = object({
  deviceId: string2().min(1).max(128),
  name: string2().max(128),
  role: _enum(["host", "client"]),
  platform: string2().max(32),
  identityKey: string2().regex(/^[A-Za-z0-9_-]{43}$/),
  clientVersion: string2().nullable().optional(),
  harnessVersion: string2().nullable().optional()
}).strict();
var pairingCreatedSchema = object({
  v: literal(1),
  sessionId: string2().uuid(),
  expiresAt: number2().int().positive(),
  serverPublicKey: string2().regex(/^[A-Za-z0-9_-]{43}$/),
  scanSecret: string2().regex(/^[A-Za-z0-9_-]{43}$/),
  host: pairingDeviceSchema
}).strict();
var pairingCredentialsSchema = object({
  account: string2().min(1).max(254),
  accountKind: _enum(["standard", "device_only"]),
  device: pairingDeviceSchema,
  inboundOnly: boolean2(),
  pairingRestricted: boolean2(),
  tokens: deviceTokenPairSchema
}).strict();
var pairingStatusSchema = object({
  v: literal(1),
  sessionId: string2().uuid(),
  state: _enum(["created", "claimed", "approved", "completed", "failed", "cancelled", "expired"]),
  expiresAt: number2().int().positive(),
  recoverUntil: number2().int().positive(),
  failureReason: string2().nullable(),
  attemptConsumed: boolean2(),
  submissionId: string2().nullable(),
  host: pairingDeviceSchema,
  mobile: pairingDeviceSchema.nullable(),
  credentials: pairingCredentialsSchema.nullable()
}).strict();
var savedPairingSchema = object({
  serverUrl: string2().url(),
  deviceId: string2(),
  session: pairingCreatedSchema,
  qrFormat: literal("fragment-ticket-v1").optional(),
  state: pairingStatusSchema.shape.state,
  mobile: pairingDeviceSchema.optional(),
  submission: string2().optional(),
  localSaved: boolean2()
}).strict();

// packages/plugin/src/host-pairing.ts
var root = "/api/v1/device-pairing/sessions";
var active = new Set(["created", "claimed", "approved"]);
function rawKey(text) {
  const bytes = Buffer.from(text, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== text)
    throw new ServerApiError("PAIRING_IDENTITY_INVALID", "Invalid pairing key.", false);
  return bytes;
}
function pairingProof(privateKey, serverKey, id, path, raw, side = "host") {
  const local = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), rawKey(privateKey)]), format: "der", type: "pkcs8" });
  const peer = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), rawKey(serverKey)]), format: "der", type: "spki" });
  const shared = diffieHellman({ privateKey: local, publicKey: peer });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.from(id), Buffer.from("dsh-pairing-v1/" + side), 32));
  try {
    return createHmac("sha256", key).update(`POST
${path}
${createHash("sha256").update(raw).digest("hex")}`).digest("base64url");
  } finally {
    shared.fill(0);
    key.fill(0);
  }
}
var fullFingerprint = (key) => createHash("sha256").update(rawKey(key)).digest("hex");

class HostPairing {
  identity;
  descriptor;
  adopt;
  fetcher;
  path;
  serverUrl;
  lifetime = new AbortController;
  queue = Promise.resolve();
  constructor(serverUrl, directory, identity, descriptor, adopt, fetcher = fetch, httpServerAllowlist = []) {
    this.identity = identity;
    this.descriptor = descriptor;
    this.adopt = adopt;
    this.fetcher = fetcher;
    this.serverUrl = normalizeServerUrl(serverUrl, httpServerAllowlist);
    this.path = join2(directory, "host-pairing.json");
  }
  close() {
    this.lifetime.abort();
  }
  async discard() {
    this.close();
    await this.queue.catch(() => {
      return;
    });
    await rm2(this.path, { force: true });
  }
  serial(fn) {
    const task = this.queue.catch(() => {
      return;
    }).then(fn);
    this.queue = task;
    return task;
  }
  start() {
    return this.serial(async () => {
      const old = await this.load();
      if (old) {
        const status = await this.poll(old);
        if (active.has(status.state))
          await this.send(old, "host/cancel", "{}");
      }
      const discovery = await this.request("/api/v1/auth/oauth/providers", undefined, undefined, "GET");
      const compactQr = discovery.capabilities?.devicePairingQr === "fragment-ticket-v1";
      const session = pairingCreatedSchema.parse(await this.request(root, JSON.stringify({ v: 1, device: this.descriptor })));
      this.assertHost(session.host);
      if (session.expiresAt <= Date.now() || session.expiresAt > Date.now() + 240000)
        throw new ServerApiError("INVALID_MESSAGE", "Invalid pairing expiry.", false);
      const saved = { serverUrl: this.serverUrl, deviceId: this.identity.deviceId, session, state: "created", localSaved: false, ...compactQr ? { qrFormat: "fragment-ticket-v1" } : {} };
      await this.save(saved);
      return this.view(saved);
    });
  }
  status() {
    return this.serial(async () => {
      const saved = await this.load();
      return saved ? this.poll(saved) : undefined;
    });
  }
  confirm(id, code) {
    return this.serial(async () => {
      const saved = await this.requireSession(id);
      let raw;
      if (saved.submission !== undefined) {
        if (code !== undefined)
          throw new ServerApiError("PAIRING_ATTEMPT_USED", "Recover the original submission without changing the code.", false);
        raw = this.crypt(saved.submission, id, false);
      } else {
        if (saved.state !== "claimed" || typeof code !== "string" || !/^[0-9]{8}$/.test(code))
          throw new ServerApiError("INVALID_MESSAGE", "Confirm on the phone and enter 8 digits.", false);
        raw = JSON.stringify({ submissionId: uuidV7(), verificationCode: code });
        saved.submission = this.crypt(raw, id, true);
        await this.save(saved);
      }
      return this.accept(saved, await this.send(saved, "host/confirm", raw));
    });
  }
  cancel(id) {
    return this.serial(async () => {
      const s = await this.requireSession(id);
      return this.accept(s, await this.send(s, "host/cancel", "{}"));
    });
  }
  async load() {
    const value = await readPrivateJson(this.path);
    if (value === undefined)
      return;
    const s = savedPairingSchema.parse(value);
    if (s.serverUrl !== this.serverUrl || s.deviceId !== this.identity.deviceId)
      throw new ServerApiError("PAIRING_IDENTITY_INVALID", "Pairing belongs to another identity.", false);
    if (s.session.expiresAt + 300000 <= Date.now()) {
      await rm2(this.path, { force: true });
      return;
    }
    return s;
  }
  async requireSession(id) {
    const s = await this.load();
    if (!s || s.session.sessionId !== id)
      throw new ServerApiError("PAIRING_CLOSED", "This pairing was replaced or expired.", false);
    return s;
  }
  save(s) {
    return atomicWritePrivate(this.path, JSON.stringify(s));
  }
  async poll(s) {
    try {
      return await this.accept(s, await this.send(s, "host/status", "{}"));
    } catch (e) {
      if (!(e instanceof ServerApiError) || e.status !== 404)
        throw e;
      s.state = "expired";
      delete s.submission;
      await this.save(s);
      return this.view(s);
    }
  }
  assertHost(d) {
    if (d.deviceId !== this.identity.deviceId || d.role !== "host" || d.identityKey !== this.identity.publicKey)
      throw new ServerApiError("PAIRING_IDENTITY_INVALID", "Host identity changed.", false);
  }
  async accept(s, value) {
    this.lifetime.signal.throwIfAborted();
    const r = pairingStatusSchema.parse(value);
    if (r.sessionId !== s.session.sessionId || r.expiresAt !== s.session.expiresAt)
      throw new ServerApiError("INVALID_MESSAGE", "Pairing session changed.", false);
    this.assertHost(r.host);
    if (r.mobile) {
      if (r.mobile.role !== "client" || r.mobile.deviceId === this.identity.deviceId || r.mobile.identityKey === this.identity.publicKey || s.mobile && (s.mobile.deviceId !== r.mobile.deviceId || s.mobile.identityKey !== r.mobile.identityKey))
        throw new ServerApiError("PAIRING_DEVICE_CONFLICT", "Phone identity changed.", false);
      s.mobile = r.mobile;
    }
    if (r.state === "completed") {
      if (!r.credentials)
        throw new ServerApiError("INVALID_MESSAGE", "Missing Host credentials.", false);
      this.assertHost(r.credentials.device);
      if (r.credentials.pairingRestricted && !r.credentials.inboundOnly)
        throw new ServerApiError("DEVICE_SCOPE_REQUIRED", "Paired Host must remain inbound only.", false);
      if (!s.localSaved) {
        await this.adopt(r.credentials);
        s.localSaved = true;
      }
    }
    s.state = r.state;
    if (!active.has(s.state))
      delete s.submission;
    await this.save(s);
    return this.view(s, r.failureReason);
  }
  view(s, reason) {
    return {
      sessionId: s.session.sessionId,
      state: s.state,
      expiresAt: s.session.expiresAt,
      serverUrl: this.serverUrl,
      hostFingerprint: fullFingerprint(this.identity.publicKey),
      ...s.state === "created" ? { qrPayload: s.qrFormat === "fragment-ticket-v1" ? `${this.serverUrl}/pair#v1.${s.session.scanSecret}` : JSON.stringify({ type: "dsh.remote.pairing", ...s.session, serverUrl: this.serverUrl }) } : {},
      ...s.mobile ? { mobile: { deviceId: s.mobile.deviceId, name: s.mobile.name, fingerprint: fullFingerprint(s.mobile.identityKey) } } : {},
      ...reason ? { failureReason: reason } : {},
      canRetry: s.submission !== undefined && active.has(s.state),
      localSaved: s.localSaved
    };
  }
  send(s, action, raw) {
    const path = `${root}/${s.session.sessionId}/${action}`;
    return this.request(path, raw, pairingProof(this.identity.privateKey, s.session.serverPublicKey, s.session.sessionId, path, raw));
  }
  async request(path, body, proof, method = "POST") {
    try {
      const response = await this.fetcher(this.serverUrl + path, { method, redirect: "error", headers: { "Content-Type": "application/json", ...proof ? { "X-DSH-Pairing-Proof": proof } : {} }, body, signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(1e4)]) });
      if (response.status === 404 && method === "GET" && path === "/api/v1/auth/oauth/providers")
        return {};
      if (response.status === 404 && path === root)
        throw new ServerApiError("PAIRING_UNSUPPORTED", "This Server does not support pairing.", false);
      const text = await response.text();
      if (text.length > 32768)
        throw new Error("oversized response");
      const value = JSON.parse(text);
      if (!response.ok) {
        const code = value.error?.code;
        throw new ServerApiError(typeof code === "string" && /^[A-Z_]{1,80}$/.test(code) ? code : "PAIRING_REQUEST_FAILED", "Pairing failed; recover the original submission if sent.", response.status >= 500 || response.status === 429, response.status);
      }
      return value;
    } catch (e) {
      if (e instanceof ServerApiError)
        throw e;
      throw new ServerApiError("PAIRING_CONNECTION_FAILED", "Pairing result is unknown. Recover the original submission.", true);
    }
  }
  crypt(value, id, encrypt) {
    const key = createHash("sha256").update("dsh-pairing-host-submission-v1\x00").update(rawKey(this.identity.privateKey)).digest();
    try {
      if (encrypt) {
        const iv = randomBytes7(12);
        const c = createCipheriv("aes-256-gcm", key, iv);
        c.setAAD(Buffer.from(id));
        const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
        return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64url");
      }
      const b = Buffer.from(value, "base64url");
      const c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      c.setAAD(Buffer.from(id));
      c.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString("utf8");
    } finally {
      key.fill(0);
    }
  }
}
// packages/webrtc/dist/websocket-backpressure.js
async function waitForRelayCapacity(socket) {
  const started = Date.now();
  while ((socket.bufferedAmount ?? 0) > 512 * 1024) {
    if (socket.readyState !== 1 || Date.now() - started > 1e4)
      throw new Error("Relay consumer is too slow or disconnected");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (socket.readyState !== 1)
    throw new Error("Relay transport closed");
}
// packages/webrtc/dist/rtc-adapter.js
var RTC_DATA_CHANNEL_LABEL = "dsh";
var RTC_DATA_CHANNEL_OPTIONS = { ordered: true };
function summarizeIceCandidate(candidate) {
  const value = candidate?.candidate?.trim();
  if (value === undefined || value.length === 0)
    return emptyCandidateSummary();
  const parts = value.replace(/^candidate:/, "").split(/\s+/);
  const typeIndex = parts.indexOf("typ");
  const relatedAddressIndex = parts.indexOf("raddr");
  return {
    candidateType: parseCandidateType(parts[typeIndex + 1]),
    protocol: normalizeProtocol(parts[2]),
    ...summarizeAddress(parts[4]),
    ...relatedAddressIndex < 0 ? {} : relatedAddressSummary(parts[relatedAddressIndex + 1])
  };
}
function summarizeAddress(address) {
  if (address === undefined || address.length === 0)
    return { addressFamily: "unknown", addressScope: "unknown" };
  if (address.includes(":"))
    return { addressFamily: "ipv6", addressScope: summarizeIpv6Scope(address) };
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return { addressFamily: "unknown", addressScope: "unknown" };
  }
  return { addressFamily: "ipv4", addressScope: summarizeIpv4Scope(parts) };
}
function stunOnlyIceServers(iceServers) {
  const direct = [];
  for (const server of iceServers) {
    const sourceUrls = Array.isArray(server.urls) ? server.urls : [server.urls];
    const urls = sourceUrls.filter(isStunUrl);
    if (urls.length === 0)
      continue;
    direct.push({ urls: Array.isArray(server.urls) ? urls : urls[0] });
  }
  return direct;
}
function isStunUrl(url) {
  const value = url.trim().toLowerCase();
  return value.startsWith("stun:") || value.startsWith("stuns:");
}
function emptyCandidateSummary() {
  return { candidateType: "unknown", addressFamily: "unknown", addressScope: "unknown" };
}
function parseCandidateType(value) {
  if (value === "host" || value === "srflx" || value === "prflx" || value === "relay")
    return value;
  return "unknown";
}
function normalizeProtocol(value) {
  if (value === undefined || value.length === 0)
    return;
  return value.toLowerCase();
}
function relatedAddressSummary(address) {
  const summary = summarizeAddress(address);
  return {
    relatedAddressFamily: summary.addressFamily,
    relatedAddressScope: summary.addressScope
  };
}
function summarizeIpv4Scope(parts) {
  if (parts[0] === 0 || parts[0] >= 240)
    return "reserved";
  if (parts[0] === 127)
    return "loopback";
  if (parts[0] === 169 && parts[1] === 254)
    return "link-local";
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    return "cgnat";
  if (parts[0] >= 224)
    return "reserved";
  if (parts[0] === 10)
    return "private";
  if (parts[0] === 192 && parts[1] === 168)
    return "private";
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    return "private";
  return "public";
}
function summarizeIpv6Scope(address) {
  const value = address.toLowerCase();
  if (value === "::1")
    return "loopback";
  if (value.startsWith("fe80:"))
    return "link-local";
  if (value.startsWith("fd7a:115c:a1e0:"))
    return "cgnat";
  if (value.startsWith("fc") || value.startsWith("fd"))
    return "private";
  if (value.startsWith("ff"))
    return "reserved";
  return "public";
}
// packages/webrtc/dist/rtc-chunking.js
var RTC_CHUNK_MAGIC = new Uint8Array([82, 84, 67, 72]);
var RTC_CHUNK_HEADER_BYTES = 12;
var RTC_CHUNK_PAYLOAD_BYTES = 8 * 1024;
var RTC_CHUNK_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
var RTC_CHUNK_MAX_TOTAL = Math.ceil(RTC_CHUNK_MAX_MESSAGE_BYTES / RTC_CHUNK_PAYLOAD_BYTES);
var MAX_IN_FLIGHT_MESSAGES = 8;
var MAX_ASSEMBLY_AGE_MS = 30000;

class RtcChunkCodec {
  nextMessageId = 1;
  assemblies = new Map;
  encode(data) {
    if (data.byteLength <= RTC_CHUNK_PAYLOAD_BYTES)
      return [data];
    if (data.byteLength > RTC_CHUNK_MAX_MESSAGE_BYTES) {
      throw new Error("WebRTC transport message exceeds the reassembly limit.");
    }
    const messageId = this.nextMessageId;
    this.nextMessageId = messageId === 4294967295 ? 1 : messageId + 1;
    const total = Math.ceil(data.byteLength / RTC_CHUNK_PAYLOAD_BYTES);
    const frames = [];
    for (let index = 0;index < total; index += 1) {
      const start = index * RTC_CHUNK_PAYLOAD_BYTES;
      const chunk = data.subarray(start, Math.min(data.byteLength, start + RTC_CHUNK_PAYLOAD_BYTES));
      const frame = new Uint8Array(RTC_CHUNK_HEADER_BYTES + chunk.byteLength);
      frame.set(RTC_CHUNK_MAGIC);
      const view = new DataView(frame.buffer);
      view.setUint32(4, messageId);
      view.setUint16(8, index);
      view.setUint16(10, total);
      frame.set(chunk, RTC_CHUNK_HEADER_BYTES);
      frames.push(frame);
    }
    return frames;
  }
  decode(frame) {
    if (!isChunk(frame)) {
      if (frame.byteLength > RTC_CHUNK_MAX_MESSAGE_BYTES) {
        throw new Error("WebRTC transport message exceeds the reassembly limit.");
      }
      return frame;
    }
    if (frame.byteLength < RTC_CHUNK_HEADER_BYTES)
      throw new Error("WebRTC transport chunk header is invalid.");
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const messageId = view.getUint32(4);
    const index = view.getUint16(8);
    const total = view.getUint16(10);
    if (messageId === 0 || total < 2 || total > RTC_CHUNK_MAX_TOTAL || index >= total) {
      throw new Error("WebRTC transport chunk metadata is invalid.");
    }
    const chunk = frame.subarray(RTC_CHUNK_HEADER_BYTES);
    if (chunk.byteLength > RTC_CHUNK_PAYLOAD_BYTES || index < total - 1 && chunk.byteLength !== RTC_CHUNK_PAYLOAD_BYTES || index === total - 1 && chunk.byteLength === 0) {
      throw new Error("WebRTC transport chunk length is invalid.");
    }
    this.pruneStale();
    let assembly = this.assemblies.get(messageId);
    if (assembly === undefined) {
      if (index !== 0 || this.assemblies.size >= MAX_IN_FLIGHT_MESSAGES) {
        throw new Error("WebRTC transport chunk sequence is invalid.");
      }
      assembly = { messageId, total, receivedBytes: 0, chunks: [], updatedAt: Date.now() };
      this.assemblies.set(messageId, assembly);
    }
    if (assembly.total !== total || index !== assembly.chunks.length) {
      this.assemblies.delete(messageId);
      throw new Error("WebRTC transport chunk sequence is invalid.");
    }
    const receivedBytes = assembly.receivedBytes + chunk.byteLength;
    if (receivedBytes > RTC_CHUNK_MAX_MESSAGE_BYTES) {
      this.assemblies.delete(messageId);
      throw new Error("WebRTC transport message exceeds the reassembly limit.");
    }
    assembly.chunks.push(Uint8Array.from(chunk));
    assembly.receivedBytes = receivedBytes;
    assembly.updatedAt = Date.now();
    if (assembly.chunks.length < total)
      return;
    this.assemblies.delete(messageId);
    const message = new Uint8Array(assembly.receivedBytes);
    let offset = 0;
    for (const part of assembly.chunks) {
      message.set(part, offset);
      offset += part.byteLength;
    }
    return message;
  }
  reset() {
    this.nextMessageId = 1;
    this.assemblies.clear();
  }
  pruneStale() {
    const now = Date.now();
    for (const [messageId, assembly] of this.assemblies) {
      if (now - assembly.updatedAt > MAX_ASSEMBLY_AGE_MS)
        this.assemblies.delete(messageId);
    }
  }
}
function isChunk(frame) {
  if (frame.byteLength < RTC_CHUNK_MAGIC.byteLength)
    return false;
  for (let index = 0;index < RTC_CHUNK_MAGIC.byteLength; index += 1) {
    if (frame[index] !== RTC_CHUNK_MAGIC[index])
      return false;
  }
  return true;
}
// packages/webrtc/dist/rtc-data-channel.js
var DEFAULT_NEGOTIATE_TIMEOUT_MS = 8000;
var SELECTED_PATH_RETRY_COUNT = 5;
var SELECTED_PATH_RETRY_DELAY_MS = 50;

class RtcDataChannelTransport {
  pc;
  role;
  onSignal;
  negotiateTimeoutMs;
  channelLabel;
  sendTimeoutMs;
  label;
  onDiagnostic;
  channel;
  remoteCandidates = [];
  remoteDescriptionSet = false;
  opened = false;
  closed = false;
  messageHandlers = new Set;
  closeHandlers = new Set;
  errorHandlers = new Set;
  connectPromise;
  openResolve;
  openReject;
  negotiateTimer;
  removeAbort;
  watchdogTimer;
  outgoing = new RtcChunkCodec;
  incoming = new RtcChunkCodec;
  bytesSent = 0;
  bytesReceived = 0;
  selected;
  selectedMode;
  selectedRelayUrlValue;
  selectedPathTelemetry;
  localCandidateTelemetry = emptyCandidateTelemetry();
  remoteCandidateTelemetry = emptyCandidateTelemetry();
  candidatePairTelemetry = emptyCandidatePairTelemetry();
  filteredLocalCandidateTelemetry = emptyCandidateTelemetry();
  filteredCandidatePairTelemetry = emptyCandidateTelemetry();
  lastBufferedAmount = 0;
  constructor(options) {
    this.role = options.role;
    this.onSignal = options.onSignal;
    this.negotiateTimeoutMs = options.negotiateTimeoutMs ?? DEFAULT_NEGOTIATE_TIMEOUT_MS;
    this.channelLabel = options.channelLabel ?? RTC_DATA_CHANNEL_LABEL;
    this.sendTimeoutMs = options.sendTimeoutMs;
    this.label = options.label;
    this.onDiagnostic = options.onDiagnostic;
    this.pc = options.factory.create({
      iceServers: options.iceServers,
      iceTransportPolicy: options.iceTransportPolicy,
      onDiagnostic: (event) => this.handlePeerDiagnostic(event)
    });
    this.pc.ondatachannel = (event) => this.adoptChannel(event.channel);
    this.pc.onicecandidate = (event) => {
      if (event.candidate !== null && !this.closed) {
        const candidate = summarizeIceCandidate(event.candidate);
        recordCandidate(this.localCandidateTelemetry, candidate);
        this.emitDiagnostic({ type: "local-candidate", candidate, diagnostics: this.diagnostics() });
        this.onSignal({ type: "ice", candidate: event.candidate });
      }
    };
    this.pc.onconnectionstatechange = () => {
      this.emitStateChange();
      this.checkConnectionState();
    };
    this.pc.oniceconnectionstatechange = () => {
      this.emitStateChange();
      this.checkConnectionState();
    };
    this.pc.onicegatheringstatechange = () => this.emitStateChange();
  }
  connect(signal) {
    if (this.closed)
      return Promise.reject(new RtcConnectError("RTC_CLOSED", "WebRTC transport closed."));
    if (signal?.aborted)
      return Promise.reject(new RtcConnectError("RTC_ABORTED", "WebRTC negotiation was aborted."));
    if (this.opened)
      return Promise.resolve();
    if (this.connectPromise !== undefined)
      return this.connectPromise;
    this.armAbort(signal);
    this.connectPromise = new Promise((resolve, reject) => {
      this.openResolve = resolve;
      this.openReject = reject;
      this.negotiateTimer = setTimeout(() => {
        this.failOpenAfterStats(new RtcConnectError("RTC_CONNECT_TIMEOUT", `WebRTC negotiation timed out after ${this.negotiateTimeoutMs}ms.`));
      }, this.negotiateTimeoutMs);
      if (this.role === "initiator") {
        this.startInitiator().catch((error) => this.failOpen(asError(error)));
      }
    });
    return this.connectPromise;
  }
  handleSignal(signal) {
    if (this.closed)
      return;
    if (signal.type === "offer")
      this.handleOffer(signal.sdp);
    else if (signal.type === "answer")
      this.handleAnswer(signal.sdp);
    else
      this.handleIce(signal.candidate);
  }
  async send(data) {
    const channel = this.requireOpenChannel();
    if (channel.readyState !== "open")
      throw new Error("WebRTC data channel is not open.");
    for (const frame of this.outgoing.encode(data)) {
      try {
        channel.send(toArrayBuffer(frame));
      } catch (error) {
        console.error("[rtc-send-error] bytes=" + frame.byteLength, error instanceof Error ? error.message : error);
        throw error;
      }
    }
    this.bytesSent += data.byteLength;
    this.armWatchdog(channel);
  }
  onMessage(handler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }
  onClose(handler) {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
  onError(handler) {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }
  selectedTransport() {
    return this.selected;
  }
  selectedRelayUrl() {
    return this.selectedRelayUrlValue;
  }
  selectedPathMode() {
    return this.selectedMode;
  }
  diagnostics() {
    return {
      role: this.role,
      ...this.label === undefined ? {} : { label: this.label },
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      iceGatheringState: this.pc.iceGatheringState,
      localCandidates: cloneCandidateTelemetry(this.localCandidateTelemetry),
      remoteCandidates: cloneCandidateTelemetry(this.remoteCandidateTelemetry),
      candidatePairs: cloneCandidatePairTelemetry(this.candidatePairTelemetry),
      filteredLocalCandidates: cloneCandidateTelemetry(this.filteredLocalCandidateTelemetry),
      filteredCandidatePairs: cloneCandidateTelemetry(this.filteredCandidatePairTelemetry),
      ...this.selectedPathTelemetry === undefined ? {} : { selectedPath: { ...this.selectedPathTelemetry } }
    };
  }
  async connectionDetails() {
    let statsDetails = {};
    try {
      statsDetails = await this.refreshStatsDiagnostics();
    } catch {}
    return {
      ...statsDetails,
      mode: statsDetails.mode ?? this.selectedMode,
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      dataChannelState: this.channel?.readyState,
      diagnostics: this.diagnostics()
    };
  }
  getStats() {
    const connected = this.channel?.readyState === "open";
    return {
      mode: !connected ? "Disconnected" : this.selectedMode ?? (this.selected === "turn" ? "TURN" : this.selected === "lan" ? "LAN" : "P2P"),
      connected,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived
    };
  }
  async close() {
    if (this.closed)
      return;
    this.closed = true;
    this.clearNegotiation();
    this.openReject?.(new RtcConnectError("RTC_CLOSED", "WebRTC transport closed during negotiation."));
    this.openResolve = undefined;
    this.openReject = undefined;
    this.clearWatchdog();
    const channel = this.channel;
    this.channel = undefined;
    if (channel !== undefined) {
      channel.onopen = null;
      channel.onmessage = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onbufferedamountlow = null;
      try {
        channel.close();
      } catch {}
    }
    this.pc.onicecandidate = null;
    this.pc.ondatachannel = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    try {
      this.pc.close();
    } catch {}
    if (this.opened) {
      this.opened = false;
      for (const handler of this.closeHandlers)
        handler();
    }
  }
  armAbort(signal) {
    this.removeAbort?.();
    this.removeAbort = undefined;
    if (signal === undefined)
      return;
    const onAbort = () => {
      this.failOpen(new RtcConnectError("RTC_ABORTED", "WebRTC negotiation was aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    this.removeAbort = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted)
      onAbort();
  }
  async startInitiator() {
    const channel = this.pc.createDataChannel(this.channelLabel, RTC_DATA_CHANNEL_OPTIONS);
    this.adoptChannel(channel);
    const offer = await this.pc.createOffer();
    if (this.closed)
      return;
    await this.pc.setLocalDescription(offer);
    if (this.closed)
      return;
    this.onSignal({ type: "offer", sdp: requireSdp(offer) });
  }
  async handleOffer(sdp) {
    if (this.role !== "responder" || this.remoteDescriptionSet) {
      this.failOpen(new RtcConnectError("RTC_INVALID_STATE", "Received an unexpected WebRTC offer."));
      return;
    }
    try {
      await this.pc.setRemoteDescription({ type: "offer", sdp });
      this.remoteDescriptionSet = true;
      await this.flushRemoteCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.onSignal({ type: "answer", sdp: requireSdp(answer) });
    } catch (error) {
      this.failOpen(asError(error));
    }
  }
  async handleAnswer(sdp) {
    if (this.role !== "initiator" || this.remoteDescriptionSet) {
      this.failOpen(new RtcConnectError("RTC_INVALID_STATE", "Received an unexpected WebRTC answer."));
      return;
    }
    try {
      await this.pc.setRemoteDescription({ type: "answer", sdp });
      this.remoteDescriptionSet = true;
      await this.flushRemoteCandidates();
    } catch (error) {
      this.failOpen(asError(error));
    }
  }
  async handleIce(candidate) {
    const summary = summarizeIceCandidate(candidate);
    if (!this.remoteDescriptionSet) {
      recordCandidate(this.remoteCandidateTelemetry, summary);
      this.emitDiagnostic({ type: "remote-candidate", candidate: summary, action: "buffered", diagnostics: this.diagnostics() });
      this.remoteCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
      recordCandidate(this.remoteCandidateTelemetry, summary);
      this.emitDiagnostic({ type: "remote-candidate", candidate: summary, action: "added", diagnostics: this.diagnostics() });
    } catch {
      this.emitDiagnostic({ type: "remote-candidate", candidate: summary, action: "ignored", diagnostics: this.diagnostics() });
    }
  }
  async flushRemoteCandidates() {
    const buffered = this.remoteCandidates.splice(0, this.remoteCandidates.length);
    for (const candidate of buffered) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {}
    }
  }
  adoptChannel(channel) {
    if (this.channel !== undefined && this.channel !== channel) {
      try {
        channel.close();
      } catch {}
      return;
    }
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      if (this.closed || this.opened)
        return;
      this.opened = true;
      const resolve = this.openResolve;
      this.clearNegotiation();
      this.resolveSelectedTransport().then(() => {
        if (this.closed)
          return;
        this.openResolve = undefined;
        this.openReject = undefined;
        resolve?.();
      });
    };
    channel.onmessage = (event) => {
      if (this.closed || !this.opened)
        return;
      const data = event.data;
      const frame = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
      this.bytesReceived += frame.byteLength;
      try {
        const message = this.incoming.decode(frame);
        if (message === undefined)
          return;
        for (const handler of this.messageHandlers)
          handler(message);
      } catch {
        this.close();
      }
    };
    channel.onclose = () => {
      if (this.closed)
        return;
      this.failOpen(new RtcConnectError("RTC_CLOSED", "WebRTC data channel closed."));
      if (this.opened) {
        this.opened = false;
        for (const handler of this.closeHandlers)
          handler();
      }
    };
    channel.onerror = () => {
      const error = new RtcConnectError("RTC_FAILED", "WebRTC data channel reported an error.");
      this.failOpen(error);
      for (const handler of this.errorHandlers)
        handler(error);
    };
  }
  async resolveSelectedTransport() {
    try {
      let selected = await this.refreshStatsDiagnostics();
      for (let attempt = 0;attempt < SELECTED_PATH_RETRY_COUNT && !this.closed && (selected.transport === undefined || selected.mode === undefined || selected.mode === "P2P"); attempt += 1) {
        await sleep(SELECTED_PATH_RETRY_DELAY_MS);
        selected = await this.refreshStatsDiagnostics();
      }
      this.selected = selected?.transport;
      this.selectedMode = selected?.mode;
      this.selectedRelayUrlValue = selected?.relayUrl;
      this.selectedPathTelemetry = selectedPathTelemetry(selected);
      this.emitDiagnostic({
        type: "selected-path",
        selectedPath: this.selectedPathTelemetry,
        diagnostics: this.diagnostics()
      });
    } catch {
      this.selected = undefined;
      this.selectedMode = undefined;
    }
  }
  checkConnectionState() {
    if (this.closed || this.opened)
      return;
    if (this.pc.connectionState === "failed" || this.pc.iceConnectionState === "failed" || this.pc.connectionState === "closed" || this.pc.iceConnectionState === "closed") {
      this.failOpenAfterStats(new RtcConnectError("RTC_FAILED", "WebRTC peer connection failed before the data channel opened."));
    }
  }
  async failOpenAfterStats(error) {
    await this.refreshStatsDiagnostics().catch(() => {
      return;
    });
    this.failOpen(error);
  }
  failOpen(error) {
    if (this.closed || this.opened || this.openReject === undefined)
      return;
    const reject = this.openReject;
    this.clearNegotiation();
    this.openResolve = undefined;
    this.openReject = undefined;
    reject(error);
    this.close();
  }
  clearNegotiation() {
    if (this.negotiateTimer !== undefined)
      clearTimeout(this.negotiateTimer);
    this.negotiateTimer = undefined;
    this.removeAbort?.();
    this.removeAbort = undefined;
  }
  requireOpenChannel() {
    const channel = this.channel;
    if (channel === undefined || channel.readyState !== "open" || this.closed || !this.opened) {
      throw new Error("WebRTC data channel is not open.");
    }
    return channel;
  }
  armWatchdog(channel) {
    if (this.closed || this.sendTimeoutMs === undefined || this.sendTimeoutMs <= 0)
      return;
    if (this.watchdogTimer !== undefined)
      clearTimeout(this.watchdogTimer);
    this.watchdogTimer = undefined;
    const baseline = channel.bufferedAmount;
    if (baseline <= 0) {
      this.lastBufferedAmount = 0;
      return;
    }
    this.lastBufferedAmount = baseline;
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = undefined;
      if (this.closed || this.channel !== channel || channel.readyState !== "open")
        return;
      const current = channel.bufferedAmount;
      if (current > 0 && current >= this.lastBufferedAmount) {
        const error = new RtcConnectError("RTC_SEND_TIMEOUT", "DataChannel send stalled.");
        for (const handler of this.errorHandlers)
          handler(error);
        this.close();
        return;
      }
      this.lastBufferedAmount = current;
      if (current > 0)
        this.armWatchdog(channel);
    }, this.sendTimeoutMs);
  }
  clearWatchdog() {
    if (this.watchdogTimer !== undefined)
      clearTimeout(this.watchdogTimer);
    this.watchdogTimer = undefined;
    this.lastBufferedAmount = 0;
  }
  async refreshStatsDiagnostics() {
    const stats = [...await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebRTC statistics timed out.")), 250);
      Promise.resolve().then(() => this.pc.getStats()).then(resolve, reject).finally(() => clearTimeout(timer));
    })];
    if (this.closed)
      return {};
    this.candidatePairTelemetry = inspectCandidatePairs(stats);
    return inspectSelectedPath(stats);
  }
  handlePeerDiagnostic(event) {
    if (event.type === "local-candidate-filtered") {
      recordCandidate(this.filteredLocalCandidateTelemetry, event.candidate);
      this.emitDiagnostic({
        type: event.type,
        candidate: event.candidate,
        reason: event.reason,
        diagnostics: this.diagnostics()
      });
      return;
    }
    if (event.localCandidate !== undefined)
      recordCandidate(this.filteredCandidatePairTelemetry, event.localCandidate);
    this.emitDiagnostic({
      type: event.type,
      localCandidate: event.localCandidate,
      reason: event.reason,
      diagnostics: this.diagnostics()
    });
  }
  emitStateChange() {
    this.emitDiagnostic({
      type: "state-change",
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      iceGatheringState: this.pc.iceGatheringState,
      diagnostics: this.diagnostics()
    });
  }
  emitDiagnostic(event) {
    try {
      this.onDiagnostic?.(event);
    } catch {}
  }
}

class RtcConnectError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function inspectSelectedPath(stats) {
  const candidates = new Map;
  const candidatePairs = new Map;
  const selectedPairs = [];
  const selectedPairIds = new Set;
  for (const [reportId, entry] of stats) {
    if (entry.type === "local-candidate" || entry.type === "remote-candidate") {
      if (typeof entry.candidateType === "string" && entry.id !== undefined) {
        candidates.set(String(entry.id), entry);
      }
    } else if (entry.type === "candidate-pair") {
      candidatePairs.set(String(entry.id ?? reportId), entry);
      if (entry.selected === true || entry.nominated === true)
        selectedPairs.push(entry);
    } else if (entry.type === "transport" && typeof entry.selectedCandidatePairId === "string") {
      selectedPairIds.add(entry.selectedCandidatePairId);
    }
  }
  const pairs = [
    ...[...selectedPairIds].map((id) => candidatePairs.get(id)).filter((pair) => pair !== undefined),
    ...selectedPairs
  ];
  for (const pair of pairs) {
    const local = candidates.get(String(pair.localCandidateId));
    const remote = candidates.get(String(pair.remoteCandidateId));
    const localType = local?.candidateType;
    const remoteType = remote?.candidateType;
    const localAddressScope = summarizeAddress(candidateAddressValue(local)).addressScope;
    const remoteAddressScope = summarizeAddress(candidateAddressValue(remote)).addressScope;
    let selected;
    if (localType === "relay" || remoteType === "relay")
      selected = { transport: "turn", mode: "TURN" };
    const relayUrl = localType === "relay" ? stringStat(local, "url") : undefined;
    if (local === undefined && remote === undefined)
      continue;
    const lan = isLanCandidatePair(localType, remoteType, localAddressScope, remoteAddressScope);
    selected ??= { transport: lan ? "lan" : "p2p", mode: lan ? "LAN" : "P2P" };
    const currentRoundTripTime = numberStat(pair, "currentRoundTripTime");
    return {
      ...selected,
      ...relayUrl === undefined ? {} : { relayUrl },
      localCandidateType: stringStat(local, "candidateType"),
      remoteCandidateType: stringStat(remote, "candidateType"),
      localAddressScope,
      remoteAddressScope,
      localAddress: candidateAddress(local),
      remoteAddress: candidateAddress(remote),
      protocol: stringStat(local, "protocol") ?? stringStat(remote, "protocol"),
      relayProtocol: stringStat(local, "relayProtocol") ?? stringStat(remote, "relayProtocol"),
      currentRoundTripTimeMs: currentRoundTripTime === undefined ? undefined : Math.round(currentRoundTripTime * 1000),
      availableOutgoingBitrate: numberStat(pair, "availableOutgoingBitrate"),
      bytesSent: numberStat(pair, "bytesSent"),
      bytesReceived: numberStat(pair, "bytesReceived")
    };
  }
  return {};
}
function inspectCandidatePairs(stats) {
  const candidates = new Map;
  const telemetry = emptyCandidatePairTelemetry();
  const pairs = [];
  for (const [reportId, entry] of stats) {
    if (entry.type === "local-candidate" || entry.type === "remote-candidate") {
      if (typeof entry.candidateType === "string" && entry.id !== undefined) {
        candidates.set(String(entry.id), entry);
      }
    } else if (entry.type === "candidate-pair") {
      pairs.push({ ...entry, id: entry.id ?? reportId });
    }
  }
  for (const pair of pairs) {
    telemetry.total += 1;
    if (pair.nominated === true)
      telemetry.nominated += 1;
    if (pair.selected === true)
      telemetry.selected += 1;
    increment(telemetry.byState, stringStat(pair, "state") ?? (pair.selected === true ? "selected" : "unknown"));
    const local = candidates.get(String(pair.localCandidateId));
    const remote = candidates.get(String(pair.remoteCandidateId));
    recordCandidateStats(telemetry.byLocalType, telemetry.byLocalFamily, telemetry.byLocalScope, local);
    recordCandidateStats(telemetry.byRemoteType, telemetry.byRemoteFamily, telemetry.byRemoteScope, remote);
  }
  return telemetry;
}
function candidateAddress(candidate) {
  const address = stringStat(candidate, "address") ?? stringStat(candidate, "ip");
  if (address === undefined)
    return;
  const port = numberStat(candidate, "port");
  return port === undefined ? address : `${address}:${port}`;
}
function stringStat(entry, key) {
  const value = entry?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function numberStat(entry, key) {
  const value = entry?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function emptyCandidateTelemetry() {
  return {
    total: 0,
    byType: {},
    byFamily: {},
    byScope: {},
    byProtocol: {}
  };
}
function cloneCandidateTelemetry(value) {
  return {
    total: value.total,
    byType: { ...value.byType },
    byFamily: { ...value.byFamily },
    byScope: { ...value.byScope },
    byProtocol: { ...value.byProtocol }
  };
}
function emptyCandidatePairTelemetry() {
  return {
    total: 0,
    nominated: 0,
    selected: 0,
    byState: {},
    byLocalType: {},
    byRemoteType: {},
    byLocalFamily: {},
    byRemoteFamily: {},
    byLocalScope: {},
    byRemoteScope: {}
  };
}
function cloneCandidatePairTelemetry(value) {
  return {
    total: value.total,
    nominated: value.nominated,
    selected: value.selected,
    byState: { ...value.byState },
    byLocalType: { ...value.byLocalType },
    byRemoteType: { ...value.byRemoteType },
    byLocalFamily: { ...value.byLocalFamily },
    byRemoteFamily: { ...value.byRemoteFamily },
    byLocalScope: { ...value.byLocalScope },
    byRemoteScope: { ...value.byRemoteScope }
  };
}
function recordCandidate(telemetry, candidate) {
  telemetry.total += 1;
  increment(telemetry.byType, candidate.candidateType);
  increment(telemetry.byFamily, candidate.addressFamily);
  increment(telemetry.byScope, candidate.addressScope);
  if (candidate.protocol !== undefined)
    increment(telemetry.byProtocol, candidate.protocol);
}
function recordCandidateStats(byType, byFamily, byScope, candidate) {
  const candidateType = candidateTypeStat(candidate);
  const address = summarizeAddress(candidateAddressValue(candidate));
  increment(byType, candidateType);
  increment(byFamily, address.addressFamily);
  increment(byScope, address.addressScope);
}
function candidateTypeStat(candidate) {
  const value = stringStat(candidate, "candidateType");
  if (value === "host" || value === "srflx" || value === "prflx" || value === "relay")
    return value;
  return "unknown";
}
function candidateAddressValue(candidate) {
  return stringStat(candidate, "address") ?? stringStat(candidate, "ip");
}
function isLanCandidatePair(localType, remoteType, localScope, remoteScope) {
  if (localType === "host" && remoteType === "host") {
    return !isExplicitlyNonLanScope(localScope) && !isExplicitlyNonLanScope(remoteScope);
  }
  const directTypes = new Set(["host", "prflx"]);
  if (!directTypes.has(String(localType)) || !directTypes.has(String(remoteType)))
    return false;
  if (isLocalNetworkScope(localScope) && isLocalNetworkScope(remoteScope))
    return true;
  return localType === "host" && isLocalNetworkScope(localScope) && remoteType === "prflx" && remoteScope === "unknown" || remoteType === "host" && isLocalNetworkScope(remoteScope) && localType === "prflx" && localScope === "unknown";
}
function isLocalNetworkScope(scope) {
  return scope === "private" || scope === "link-local" || scope === "loopback";
}
function isExplicitlyNonLanScope(scope) {
  return scope === "public" || scope === "cgnat" || scope === "reserved";
}
function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}
function selectedPathTelemetry(details) {
  return {
    ...details.transport === undefined ? {} : { transport: details.transport },
    ...details.mode === undefined ? {} : { mode: details.mode },
    ...details.relayUrl === undefined ? {} : { relayUrl: details.relayUrl },
    ...details.localCandidateType === undefined ? {} : { localCandidateType: details.localCandidateType },
    ...details.remoteCandidateType === undefined ? {} : { remoteCandidateType: details.remoteCandidateType },
    ...details.localAddressScope === undefined ? {} : { localAddressScope: details.localAddressScope },
    ...details.remoteAddressScope === undefined ? {} : { remoteAddressScope: details.remoteAddressScope },
    ...details.protocol === undefined ? {} : { protocol: details.protocol },
    ...details.relayProtocol === undefined ? {} : { relayProtocol: details.relayProtocol },
    ...details.currentRoundTripTimeMs === undefined ? {} : { currentRoundTripTimeMs: details.currentRoundTripTimeMs },
    ...details.availableOutgoingBitrate === undefined ? {} : { availableOutgoingBitrate: details.availableOutgoingBitrate }
  };
}
function requireSdp(description) {
  if (typeof description.sdp !== "string" || description.sdp.length === 0) {
    throw new RtcConnectError("RTC_FAILED", "The RTC backend produced an empty session description.");
  }
  return description.sdp;
}
function toArrayBuffer(data) {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength)
    return data.buffer;
  return data.slice().buffer;
}
function asError(error) {
  return error instanceof Error ? error : new RtcConnectError("RTC_FAILED", "WebRTC negotiation failed.");
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
// packages/webrtc/dist/control-lease.js
var WEBRTC_LEASE_MS2 = 300000;

class ControlLease {
  connectionId;
  ticket;
  request;
  expired;
  confirmed = false;
  stopped = false;
  sent;
  deadline;
  sequence = 0;
  timer;
  lastRequest = -Infinity;
  constructor(connectionId, ticket, request, expired) {
    this.connectionId = connectionId;
    this.ticket = ticket;
    this.request = request;
    this.expired = expired;
  }
  start() {
    this.timer = setInterval(() => this.tick(), 1000);
    this.deadline = { mono: performance.now() + WEBRTC_LEASE_MS2, wall: Date.now() + WEBRTC_LEASE_MS2 };
    this.tick(true);
  }
  valid() {
    if (this.stopped)
      return false;
    const d = this.deadline;
    if (d && (performance.now() >= d.mono || Date.now() >= d.wall)) {
      this.stop();
      this.expired();
      return false;
    }
    return true;
  }
  remainingMs() {
    if (!this.confirmed || this.stopped || !this.deadline)
      return;
    return Math.max(0, Math.min(this.deadline.mono - performance.now(), this.deadline.wall - Date.now()));
  }
  canDetach() {
    return this.confirmed && this.valid();
  }
  recoveryTicket() {
    return this.canDetach() ? this.ticket : undefined;
  }
  tick(force = false) {
    if (!this.valid())
      return;
    const mono = performance.now();
    if (!force && mono - this.lastRequest < 25000)
      return;
    const sent = { id: String(++this.sequence), mono, wall: Date.now() };
    this.lastRequest = mono;
    try {
      this.request({ connectionId: this.connectionId, requestId: sent.id, ticket: this.ticket });
      this.sent = sent;
    } catch {}
  }
  acknowledge(ack) {
    if (!this.valid() || ack.connectionId !== this.connectionId || ack.leaseMs !== WEBRTC_LEASE_MS2)
      return;
    const sent = this.sent;
    if (!sent || sent.id !== ack.requestId)
      return;
    if (performance.now() - sent.mono >= 30000 || Date.now() - sent.wall >= 30000)
      return;
    this.sent = undefined;
    this.ticket = ack.ticket;
    this.confirmed = true;
    this.deadline = { mono: sent.mono + WEBRTC_LEASE_MS2, wall: sent.wall + WEBRTC_LEASE_MS2 };
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.sent = undefined;
  }
}
// packages/webrtc/dist/serial-send.js
class SerialSend {
  tail = Promise.resolve();
  bytes = 0;
  count = 0;
  async run(bytes, send) {
    if (this.bytes + bytes > 8 * 1024 * 1024 || this.count >= 256)
      throw new Error("Encrypted send queue exceeds its limit");
    this.bytes += bytes;
    this.count += 1;
    const task = this.tail.then(send);
    this.tail = task.catch(() => {
      return;
    });
    try {
      await task;
    } finally {
      this.bytes -= bytes;
      this.count -= 1;
    }
  }
}
// packages/plugin/src/server-connection.ts
var DEFAULT_WEBRTC_NEGOTIATE_TIMEOUT_MS = 12000;

class HostServerConnection {
  config;
  identity;
  identities;
  api;
  connections;
  logger;
  createWebSocket;
  rtcFactoryProvider;
  hostCapabilities;
  harnessVersion;
  socket;
  forceCloseSocket;
  running;
  stopped = true;
  online = false;
  retryWake;
  tunnels = new Map;
  terminalError;
  lastActiveAt;
  reconnectRequested = false;
  resumeQueued = false;
  authRecoveryAttempted = false;
  rtcFactory;
  negotiatedCapabilities = ["transport.relay"];
  controlFrameLimits = {};
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
  webRtcNegotiateTimeoutMs = DEFAULT_WEBRTC_NEGOTIATE_TIMEOUT_MS;
  constructor(config, identity, identities, api, connections, logger, createWebSocket = (url) => new WebSocket(url), rtcFactoryProvider, hostCapabilities = () => [], harnessVersion) {
    this.config = config;
    this.identity = identity;
    this.identities = identities;
    this.api = api;
    this.connections = connections;
    this.logger = logger;
    this.createWebSocket = createWebSocket;
    this.rtcFactoryProvider = rtcFactoryProvider;
    this.hostCapabilities = hostCapabilities;
    this.harnessVersion = harnessVersion;
  }
  start() {
    if (this.running !== undefined)
      return;
    this.stopped = false;
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
  }
  resume() {
    this.terminalError = undefined;
    this.stopped = false;
    if (this.running === undefined) {
      this.start();
      return;
    }
    this.retryWake?.();
    if (this.resumeQueued)
      return;
    this.resumeQueued = true;
    this.running.finally(() => {
      this.resumeQueued = false;
      if (!this.stopped)
        this.start();
    });
  }
  async stop() {
    this.stopped = true;
    this.reconnectRequested = false;
    this.retryWake?.();
    this.retryWake = undefined;
    for (const tunnel of this.tunnels.values())
      this.notifyTunnelClosed(tunnel);
    if (this.forceCloseSocket)
      this.forceCloseSocket(1000, "plugin stopped");
    else
      this.socket?.close(1000, "plugin stopped");
    await this.running;
    await this.dropTunnels();
  }
  isOnline() {
    return this.online;
  }
  recoveryExpiresAt() {
    const remaining = [...this.tunnels.values()].flatMap((tunnel) => {
      const ms = tunnel.lease?.remainingMs();
      return ms === undefined ? [] : [ms];
    });
    return remaining.length ? Date.now() + Math.min(...remaining) : undefined;
  }
  lastError() {
    return this.terminalError;
  }
  lastActivity() {
    return this.lastActiveAt;
  }
  isReconnecting() {
    return !this.online && !this.stopped && this.running !== undefined;
  }
  reconnect() {
    this.terminalError = undefined;
    this.stopped = false;
    if (this.running === undefined) {
      this.start();
      return;
    }
    this.reconnectRequested = true;
    this.retryWake?.();
    if (this.forceCloseSocket)
      this.forceCloseSocket(4000, "manual reconnect");
    else
      this.socket?.close(4000, "manual reconnect");
    this.running.finally(() => {
      if (!this.reconnectRequested || this.stopped)
        return;
      this.reconnectRequested = false;
      this.start();
    });
  }
  async run() {
    this.authRecoveryAttempted = false;
    while (!this.stopped) {
      try {
        await this.connectOnce();
      } catch (error) {
        if (this.stopped)
          return;
        const code = errorCode(error);
        if (code === "CREDENTIALS_REFRESHED")
          continue;
        this.terminalError = code;
        this.logger.warn("server control connection failed", {
          code,
          retryable: isRetryable(error),
          ...error instanceof ServerApiError && error.phase !== undefined ? { phase: error.phase } : {},
          ...error instanceof ServerApiError && error.status !== undefined ? { status: error.status } : {},
          ...error instanceof ServerApiError && error.reason !== undefined ? { reason: error.reason } : {}
        });
        if (code === "UNSUPPORTED_VERSION") {
          this.logger.warn("Server does not support the Remote protocol version; automatic reconnect is paused.");
        }
        if (TERMINAL_AUTH_ERRORS.has(code)) {
          this.logger.warn(code === "CONNECTION_REPLACED" ? "Another instance is using this Host identity. Stop it or use a separate DSH_HOME; automatic reconnect is paused." : "Host authorization failed. Authorize this Host again from a Remote client or in Remote settings.");
        }
        if (code === "DEVICE_REVOKED") {
          try {
            await this.api.clearAuthorization();
          } catch (clearError) {
            this.logger.error("failed to clear revoked Host authorization", { code: errorCode(clearError) });
          }
        }
        if (TERMINAL_AUTH_ERRORS.has(code) || code === "UNSUPPORTED_VERSION") {
          await this.dropTunnels();
          return;
        }
        if (!this.config.reconnect.enabled)
          return;
      }
      if (this.stopped)
        return;
      if (this.reconnectRequested) {
        this.reconnectRequested = false;
        continue;
      }
      if (!this.config.reconnect.enabled)
        return;
      await this.waitBeforeRetry();
      if (this.reconnectRequested) {
        this.reconnectRequested = false;
        continue;
      }
    }
  }
  async connectOnce() {
    const credentials = await this.api.authenticate(this.identity);
    if (this.stopped)
      return;
    const offeredCapabilities = this.rtcFactoryProvider === undefined || this.config.forceRelay ? [RELAY_RESUME_CAPABILITY, "transport.relay", "transport.relay.attach", ...this.hostCapabilities()] : [WEBRTC_RESUME_CAPABILITY, RELAY_RESUME_CAPABILITY, "transport.lan", "transport.p2p", "transport.turn", "transport.relay", "transport.relay.attach", ...this.hostCapabilities()];
    const recoveryTickets = [...this.tunnels.values()].flatMap((tunnel) => tunnel.lease?.recoveryTicket() ?? []).slice(0, 64);
    const socket = this.createWebSocket(websocketUrl(this.api.baseUrl));
    this.socket = socket;
    this.controlFrameLimits = {};
    this.heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
    let acknowledged = false;
    let retainOnClose = false;
    let invalidControl = false;
    let socketError;
    let messageQueue = Promise.resolve();
    await new Promise((resolve, reject) => {
      let settled = false;
      let closing = false;
      let upgradeTimer;
      let helloTimer;
      let refreshTimer;
      let livenessTimer;
      const clearLiveness = () => {
        if (livenessTimer === undefined)
          return;
        clearTimeout(livenessTimer);
        livenessTimer = undefined;
      };
      const finish = (error) => {
        if (settled)
          return;
        settled = true;
        if (upgradeTimer !== undefined)
          clearTimeout(upgradeTimer);
        if (helloTimer !== undefined)
          clearTimeout(helloTimer);
        if (refreshTimer !== undefined)
          clearTimeout(refreshTimer);
        clearLiveness();
        this.online = false;
        socket.onopen = socket.readyState === 0 ? () => {
          socket.onopen = null;
          try {
            socket.close(1000, "connection abandoned");
          } catch {}
          socket.terminate?.();
        } : null;
        socket.onmessage = null;
        socket.onerror = () => {
          return;
        };
        socket.onclose = () => {
          socket.onopen = null;
          socket.onerror = null;
          socket.onclose = null;
        };
        if (this.socket === socket) {
          this.socket = undefined;
          this.forceCloseSocket = undefined;
        }
        const preserve = this.config.reconnect.enabled && !this.stopped && !this.reconnectRequested && (error === undefined ? retainOnClose : isRetryable(error)) && !invalidControl && !TERMINAL_AUTH_ERRORS.has(this.terminalError ?? "") && [...this.tunnels.values()].some((tunnel) => tunnel.lease?.canDetach());
        const cleanup = preserve ? Promise.all([...this.tunnels.values()].filter((tunnel) => !tunnel.lease?.canDetach()).map((tunnel) => this.dropTunnel(tunnel.connectionId))) : this.dropTunnels();
        cleanup.catch(() => {
          return;
        }).finally(() => error === undefined ? resolve() : reject(error));
      };
      let forceDrainWake;
      const handleClose = (event, forced = false) => {
        if (settled || this.socket !== socket)
          return;
        if (closing) {
          if (forced) {
            forceDrainWake?.();
            if (this.stopped || this.reconnectRequested)
              finish();
          }
          return;
        }
        closing = true;
        clearLiveness();
        const closeSemantics = classifyControlClose(event.code, event.reason);
        retainOnClose = [1000, 1001, 4007].includes(event.code) || closeSemantics.retryable && !closeSemantics.replaced;
        const close = async () => {
          if (!forced) {
            let drainTimer;
            await Promise.race([
              messageQueue.catch(() => {
                return;
              }),
              new Promise((resolve) => {
                forceDrainWake = resolve;
                drainTimer = setTimeout(resolve, 50);
              })
            ]);
            if (drainTimer !== undefined)
              clearTimeout(drainTimer);
          }
          forceDrainWake = undefined;
          if (settled)
            return;
          if (this.stopped) {
            finish();
            return;
          }
          if (event.code === 4003 || event.reason === "CONNECTION_REPLACED" || socketError === "CONNECTION_REPLACED") {
            finish(new ControlConnectionError("CONNECTION_REPLACED", "Another instance connected with this Host identity."));
            return;
          }
          if (event.code === 4004 || event.reason === "DEVICE_REVOKED" || socketError === "DEVICE_REVOKED" || this.terminalError === "DEVICE_REVOKED") {
            finish(new ControlConnectionError("DEVICE_REVOKED", "The Server revoked this Host device."));
            return;
          }
          if (event.code === 4011 || event.reason === "UNSUPPORTED_VERSION" || socketError === "UNSUPPORTED_VERSION" || this.terminalError === "UNSUPPORTED_VERSION") {
            finish(new ControlConnectionError("UNSUPPORTED_VERSION", "The Server does not support the Remote protocol version."));
            return;
          }
          if (!acknowledged && recoveryTickets.length && ([4008, 4012].includes(event.code) || event.code === 4002 && event.reason === "recovery authorization rejected")) {
            await this.dropTunnels();
            if (settled)
              return;
            finish(new ControlConnectionError("CREDENTIALS_REFRESHED", "Retry control without recovery state."));
            return;
          }
          const isAuthRejection = event.code === 4002 || socketError === "AUTH_INVALID" || socketError === "TOKEN_EXPIRED" || event.code === 4001 && (event.reason === "AUTH_INVALID" || event.reason === "TOKEN_EXPIRED");
          if (isAuthRejection) {
            if (this.authRecoveryAttempted) {
              finish(new ControlConnectionError("AUTH_INVALID", "Server rejected refreshed credentials."));
              return;
            }
            this.terminalError = undefined;
            try {
              await Promise.race([
                this.api.refreshCredentials(credentials.accessToken),
                new Promise((_, rejectRefresh) => {
                  refreshTimer = setTimeout(() => rejectRefresh(new ControlConnectionError("CONNECTION_FAILED", "Credential refresh timed out.")), 15000);
                })
              ]);
            } catch (error) {
              if (refreshTimer !== undefined) {
                clearTimeout(refreshTimer);
                refreshTimer = undefined;
              }
              if (settled)
                return;
              finish(asError2(error));
              return;
            }
            if (refreshTimer !== undefined) {
              clearTimeout(refreshTimer);
              refreshTimer = undefined;
            }
            if (settled)
              return;
            this.authRecoveryAttempted = true;
            this.terminalError = undefined;
            finish(new ControlConnectionError("CREDENTIALS_REFRESHED", "Retry hello with refreshed credentials."));
            return;
          }
          const finalCode = socketError ?? closeCode(event.code);
          if (acknowledged && this.terminalError === undefined)
            this.terminalError = finalCode;
          finish(acknowledged ? undefined : new ControlConnectionError(finalCode, event.reason || "Server control connection closed."));
        };
        close();
      };
      const closeSocket = (code, reason) => {
        try {
          socket.close(code, reason);
        } catch {
          try {
            socket.close(1000, reason);
          } catch {}
        }
        socket.terminate?.();
        handleClose({ code, reason }, true);
      };
      this.forceCloseSocket = closeSocket;
      const armLiveness = () => {
        clearLiveness();
        const timeoutMs = Math.max(15000, this.heartbeatIntervalMs * 3);
        livenessTimer = setTimeout(() => {
          livenessTimer = undefined;
          if (this.stopped || settled || closing || this.socket !== socket)
            return;
          const silentMs = this.lastActiveAt === undefined ? timeoutMs : Math.max(0, Date.now() - this.lastActiveAt);
          this.logger.warn("server control heartbeat timeout; reconnecting", {
            silentMs,
            heartbeatIntervalMs: this.heartbeatIntervalMs
          });
          closeSocket(4009, "heartbeat timeout");
        }, timeoutMs);
        livenessTimer.unref?.();
      };
      upgradeTimer = setTimeout(() => closeSocket(4001, "upgrade timeout"), 30000);
      upgradeTimer.unref?.();
      socket.onopen = () => {
        if (settled || closing || this.socket !== socket)
          return;
        if (upgradeTimer !== undefined) {
          clearTimeout(upgradeTimer);
          upgradeTimer = undefined;
        }
        helloTimer = setTimeout(() => closeSocket(4001, "hello timeout"), 1e4);
        this.sendControl("hello", {
          role: "host",
          deviceId: this.identity.deviceId,
          accessToken: credentials.accessToken,
          protocols: [PROTOCOL_VERSION],
          clientVersion: PLUGIN_VERSION,
          ...this.harnessVersion === undefined ? {} : { harnessVersion: this.harnessVersion },
          capabilities: offeredCapabilities,
          ...recoveryTickets.length ? { recoveryTickets } : {}
        });
      };
      socket.onmessage = (event) => {
        if (settled || closing || this.socket !== socket)
          return;
        try {
          const preview = decodeControl(event.data, this.controlFrameLimits);
          if (preview.type === "error") {
            const payload = requireControlError(preview.payload);
            if (payload.code === "DEVICE_REVOKED" || payload.connectionId === undefined) {
              socketError = payload.code;
              if (payload.code !== "AUTH_INVALID" && payload.code !== "TOKEN_EXPIRED") {
                this.terminalError = payload.code;
              }
            }
          }
        } catch {}
        messageQueue = messageQueue.then(async () => {
          if (settled || this.socket !== socket)
            return;
          const frame = decodeControl(event.data, this.controlFrameLimits);
          this.lastActiveAt = Date.now();
          if (acknowledged)
            armLiveness();
          if (frame.type === "hello.ack") {
            const payload = requireHelloAck(frame.payload);
            this.heartbeatIntervalMs = payload.heartbeatIntervalMs;
            this.webRtcNegotiateTimeoutMs = Math.max(DEFAULT_WEBRTC_NEGOTIATE_TIMEOUT_MS, payload.webrtcFallbackTimeoutMs ?? DEFAULT_WEBRTC_NEGOTIATE_TIMEOUT_MS);
            this.authRecoveryAttempted = false;
            this.controlFrameLimits = {
              maxControlFrameBytes: payload.maxControlFrameBytes,
              maxRelayFrameBytes: payload.maxRelayFrameBytes
            };
            this.negotiatedCapabilities = acceptNegotiatedCapabilities(offeredCapabilities, payload.capabilities);
            if (!this.negotiatedCapabilities.some((capability) => capability === "transport.relay" || capability === "transport.lan" || capability === "transport.p2p" || capability === "transport.turn")) {
              throw new ControlConnectionError("INVALID_MESSAGE", "Server did not negotiate a transport capability.");
            }
            acknowledged = true;
            clearTimeout(helloTimer);
            armLiveness();
            if (this.rtcFactory === undefined && this.rtcFactoryProvider !== undefined && !this.config.forceRelay) {
              this.rtcFactoryProvider().then((factory) => {
                if (factory !== undefined)
                  this.rtcFactory ??= factory;
              }).catch(() => {
                return;
              });
            }
            for (const tunnel of [...this.tunnels.values()]) {
              const required = tunnel.transport === "relay" ? RELAY_RESUME_CAPABILITY : WEBRTC_RESUME_CAPABILITY;
              if (tunnel.lease && !this.negotiatedCapabilities.includes(required))
                await this.dropTunnel(tunnel.connectionId);
            }
            this.online = true;
            this.terminalError = undefined;
            this.logger.info("server control connection online", {
              serverVersion: payload.serverVersion,
              connectionSessionId: shortId(payload.connectionSessionId)
            });
            for (const tunnel of this.tunnels.values())
              tunnel.lease?.tick(true);
            return;
          }
          if (!acknowledged && (frame.type !== "error" || requireControlError(frame.payload).connectionId !== undefined)) {
            throw new ControlConnectionError("INVALID_MESSAGE", "Server sent a frame before hello.ack.");
          }
          await this.handleFrame(frame);
          if (!acknowledged && !closing)
            closeSocket(4001, socketError ?? "hello rejected");
        }).catch((error) => {
          if (settled || this.socket !== socket)
            return;
          invalidControl = true;
          const code = errorCode(error);
          this.terminalError = code;
          this.logger.error("server control frame failed", {
            code,
            reason: diagnosticReason(error)
          });
          closeSocket(4008, "invalid control frame");
        });
      };
      socket.onerror = () => {
        if (!acknowledged)
          finish(new ControlConnectionError("CONNECTION_FAILED", "Unable to open the Server WebSocket."));
      };
      socket.onclose = (event) => {
        handleClose(event);
      };
    });
  }
  async handleFrame(frame) {
    if (frame.type === "ping") {
      const nonce = objectValue(frame.payload, "nonce");
      if (typeof nonce !== "string")
        throw new ControlConnectionError("INVALID_MESSAGE", "Control ping has no nonce.");
      this.sendControl("pong", { nonce });
      return;
    }
    if (frame.type === "connection.lease.ack") {
      const ack = frame.payload;
      this.tunnels.get(ack.connectionId)?.lease?.acknowledge(ack);
      return;
    }
    if (frame.type === "pong")
      return;
    if (frame.type === "connect.incoming") {
      await this.handleConnectIncoming(requireConnectIncoming(frame.payload));
      return;
    }
    if (frame.type === "secure.handshake") {
      await this.handleHandshake(requireHandshake(frame.payload));
      return;
    }
    if (frame.type === "relay") {
      const payload = requireRelay(frame.payload);
      if (this.tunnels.get(payload.connectionId)?.dataSocket !== undefined)
        return;
      await this.handleRelay(payload);
      return;
    }
    if (frame.type === "signal.offer") {
      if (!this.canUseWebRtc()) {
        throw new ControlConnectionError("INVALID_MESSAGE", "Server forwarded WebRTC signaling without negotiating it.");
      }
      this.handleSignalOffer(requireSignal(frame.payload)).catch((error) => {
        if (this.stopped)
          return;
        this.logger.warn("webrtc offer handling failed", { reason: diagnosticReason(asError2(error)) });
      });
      return;
    }
    if (frame.type === "signal.ice") {
      this.handleSignalIce(requireSignalIce(frame.payload));
      return;
    }
    if (frame.type === "transport.selected") {
      await this.handleTransportSelected(requireTransportSelected(frame.payload));
      return;
    }
    if (frame.type === "signal.answer")
      return;
    if (frame.type === "error") {
      const payload = requireControlError(frame.payload);
      if (payload.code === "DEVICE_REVOKED") {
        this.terminalError = payload.code;
        if (this.forceCloseSocket)
          this.forceCloseSocket(4004, "device revoked");
        else
          this.socket?.close(4004, "device revoked");
      } else if (payload.connectionId !== undefined) {
        await this.dropTunnel(payload.connectionId, payload.code, {
          closedBy: "server",
          retryable: payload.retryable
        });
        const fields = {
          code: payload.code,
          connectionId: shortId(payload.connectionId),
          retryable: payload.retryable
        };
        if (payload.retryable)
          this.logger.info("server closed a remote connection", fields);
        else
          this.logger.warn("server closed a remote connection", fields);
      } else if (payload.code === "AUTH_INVALID" || payload.code === "TOKEN_EXPIRED") {
        this.logger.warn("server returned a control error", { code: payload.code, retryable: payload.retryable });
        if (this.forceCloseSocket)
          this.forceCloseSocket(4002, payload.code);
        else
          this.socket?.close(4002, payload.code);
      } else if (payload.code === "UNSUPPORTED_VERSION") {
        this.terminalError = payload.code;
        this.logger.warn("server returned a control error", { code: payload.code, retryable: payload.retryable });
        if (this.forceCloseSocket)
          this.forceCloseSocket(4011, "unsupported version");
        else
          this.socket?.close(4011, "unsupported version");
      } else if (payload.code === "CONNECTION_REPLACED") {
        this.terminalError = payload.code;
        this.logger.warn("server returned a control error", { code: payload.code, retryable: payload.retryable });
        if (this.forceCloseSocket)
          this.forceCloseSocket(4003, "connection replaced");
        else
          this.socket?.close(4003, "connection replaced");
      } else {
        this.terminalError = payload.code;
        this.logger.warn("server returned a control error", { code: payload.code, retryable: payload.retryable });
      }
      return;
    }
    throw new ControlConnectionError("INVALID_MESSAGE", `Unexpected Server control frame: ${frame.type}`);
  }
  async handleConnectIncoming(payload) {
    const sourceSocket = this.socket;
    let descriptor;
    try {
      descriptor = await this.api.deviceFor(payload.clientDeviceId);
    } catch (error) {
      if (this.socket !== sourceSocket)
        return;
      this.sendControl("connect.rejected", { connectionId: payload.connectionId });
      this.logger.warn("connection rejected by account authorization", {
        clientDeviceId: shortId(payload.clientDeviceId),
        code: errorCode(error)
      });
      return;
    }
    if (this.socket !== sourceSocket)
      return;
    if (descriptor.role !== "client" || descriptor.deviceId !== payload.clientDeviceId || descriptor.identityKey !== payload.clientIdentityKey) {
      this.sendControl("connect.rejected", { connectionId: payload.connectionId });
      this.logger.warn("connection rejected by peer identity validation", {
        clientDeviceId: shortId(payload.clientDeviceId)
      });
      return;
    }
    const existing = this.identities.trustedPeer(descriptor.deviceId);
    const stalePin = existing !== undefined && existing.publicKey !== descriptor.identityKey;
    const rotateStalePin = stalePin && this.config.rotatePinnedPeerKey && existing.membershipId === descriptor.membershipId;
    if (stalePin && !rotateStalePin) {
      this.sendControl("connect.rejected", { connectionId: payload.connectionId });
      this.logger.warn("connection rejected by pinned peer identity", {
        clientDeviceId: shortId(payload.clientDeviceId)
      });
      return;
    }
    if (rotateStalePin) {
      this.logger.warn("rotating pinned peer identity for same-membership device", {
        clientDeviceId: shortId(payload.clientDeviceId)
      });
    }
    const peer = existing !== undefined && !stalePin && existing.membershipId === descriptor.membershipId && existing.name === descriptor.name && existing.platform === descriptor.platform ? existing : await this.identities.trustPeer({
      deviceId: descriptor.deviceId,
      name: descriptor.name,
      platform: descriptor.platform,
      publicKey: descriptor.identityKey,
      membershipId: descriptor.membershipId
    });
    if (this.socket !== sourceSocket)
      return;
    const previous = this.tunnels.get(payload.connectionId);
    previous?.noise.destroy();
    const noise = new NoiseIkSession({
      role: "responder",
      localPrivateKey: this.identity.privateKey,
      localPublicKey: this.identity.publicKey,
      remotePublicKey: peer.publicKey,
      prologue: createNoisePrologue(payload.connectionId, this.identity.deviceId, peer.deviceId)
    });
    const tunnel = {
      recoveryTicket: this.negotiatedCapabilities.includes(WEBRTC_RESUME_CAPABILITY) ? payload.recoveryTicket : undefined,
      relayRecoveryTicket: this.negotiatedCapabilities.includes(RELAY_RESUME_CAPABILITY) ? payload.relayRecoveryTicket : undefined,
      connectionId: payload.connectionId,
      membershipId: descriptor.membershipId,
      peer,
      preferredTransports: payload.preferredTransports,
      noise,
      transport: "negotiating",
      ...typeof payload.relayEndpoint === "string" && typeof payload.relayTicket === "string" ? { relayAssignment: payload } : {}
    };
    this.tunnels.set(payload.connectionId, tunnel);
    this.sendControl("connect.accepted", { connectionId: payload.connectionId });
  }
  async handleHandshake(payload) {
    const tunnel = this.tunnels.get(payload.connectionId);
    if (tunnel !== undefined && tunnel.channel !== undefined && payload.targetDeviceId === this.identity.deviceId && payload.step === 1) {
      this.logger.warn("duplicate secure handshake ignored", {
        connectionId: shortId(tunnel.connectionId),
        peerDeviceId: shortId(tunnel.peer.deviceId)
      });
      return;
    }
    if (tunnel === undefined || payload.targetDeviceId !== this.identity.deviceId || payload.step !== 1) {
      throw new ControlConnectionError("SECURE_CHANNEL_FAILED", "Noise IK handshake is not valid for this connection.");
    }
    if (tunnel.transport === "negotiating" && (tunnel.rtc !== undefined || tunnel.relayAssignment !== undefined)) {
      if (tunnel.pendingHandshake === undefined)
        tunnel.pendingHandshake = payload;
      else
        this.logger.warn("duplicate pending secure handshake ignored", {
          connectionId: shortId(tunnel.connectionId),
          peerDeviceId: shortId(tunnel.peer.deviceId)
        });
      return;
    }
    await this.completeHandshake(tunnel, payload);
  }
  async completeHandshake(tunnel, payload) {
    tunnel.noise.readHandshake(fromBase64Url(payload.data));
    const reply = tunnel.noise.writeHandshake();
    if (!tunnel.noise.complete)
      throw new ControlConnectionError("SECURE_CHANNEL_FAILED", "Noise IK handshake did not complete.");
    const viaWebRtc = tunnel.rtc !== undefined && (tunnel.transport === "lan" || tunnel.transport === "p2p" || tunnel.transport === "turn");
    if (!viaWebRtc && tunnel.transport === "negotiating")
      tunnel.transport = "relay";
    const mode = viaWebRtc ? tunnel.transportMode ?? (tunnel.transport === "turn" ? "TURN" : tunnel.transport === "lan" ? "LAN" : "P2P") : "Relay";
    const transmit = viaWebRtc ? (ciphertext) => tunnel.rtc.send(ciphertext) : (ciphertext) => this.sendRelay(tunnel, ciphertext);
    const channel = new ServerNoiseChannel(tunnel, transmit, async () => {
      if (this.tunnels.get(tunnel.connectionId) !== tunnel)
        return;
      this.notifyTunnelClosed(tunnel);
      this.tunnels.delete(tunnel.connectionId);
      tunnel.lease?.stop();
      try {
        await tunnel.rtc?.close();
      } catch (error) {
        this.logger.warn("remote connection RTC cleanup failed", {
          connectionId: shortId(tunnel.connectionId),
          reason: diagnosticReason(error)
        });
      }
      tunnel.dataSocket?.close();
      tunnel.dataSocket = undefined;
      tunnel.dataReady = false;
    }, mode);
    tunnel.channel = channel;
    await this.connections.accept(channel);
    this.sendControl("secure.handshake", {
      connectionId: tunnel.connectionId,
      targetDeviceId: tunnel.peer.deviceId,
      step: 2,
      data: toBase64Url(reply)
    });
    const leaseTicket = viaWebRtc ? tunnel.recoveryTicket : tunnel.transport === "relay" && tunnel.dataReady && tunnel.dataSocket?.readyState === 1 ? tunnel.relayRecoveryTicket : undefined;
    if (leaseTicket) {
      tunnel.lease = new ControlLease(tunnel.connectionId, leaseTicket, (payload) => {
        const heartbeatTimeoutMs = Math.max(15000, this.heartbeatIntervalMs * 3);
        if (this.online && this.lastActiveAt !== undefined && Date.now() - this.lastActiveAt >= heartbeatTimeoutMs) {
          if (this.forceCloseSocket)
            this.forceCloseSocket(4009, "heartbeat timeout");
          else
            this.socket?.close(4009, "heartbeat timeout");
          throw new Error("Control heartbeat timed out");
        }
        this.sendControl("connection.lease.request", payload);
      }, () => {
        this.dropTunnel(tunnel.connectionId, "CONNECTION_FAILED");
      });
      tunnel.lease.start();
    }
    this.logger.info("authenticated peer channel ready", {
      connectionId: shortId(tunnel.connectionId),
      peerDeviceId: shortId(tunnel.peer.deviceId),
      transport: mode
    });
  }
  async resumePendingHandshake(tunnel) {
    const payload = tunnel.pendingHandshake;
    if (payload === undefined || tunnel.channel !== undefined || tunnel.transport === "negotiating")
      return;
    tunnel.pendingHandshake = undefined;
    await this.completeHandshake(tunnel, payload);
  }
  async handleRelay(payload) {
    if (!this.negotiatedCapabilities.includes("transport.relay")) {
      throw new ControlConnectionError("INVALID_MESSAGE", "Server forwarded Relay without negotiating it.");
    }
    if (payload.targetDeviceId !== this.identity.deviceId) {
      throw new ControlConnectionError("INVALID_MESSAGE", "Relay frame target does not match this Host.");
    }
    const tunnel = this.tunnels.get(payload.connectionId);
    if (tunnel?.channel === undefined) {
      this.logger.warn("stale relay frame ignored", {
        connectionId: shortId(payload.connectionId)
      });
      return;
    }
    try {
      tunnel.channel.receive(payload.counter, fromBase64Url(payload.ciphertext));
    } catch (error) {
      await tunnel.channel.close();
      throw new ControlConnectionError("SECURE_CHANNEL_FAILED", asError2(error).message);
    }
  }
  async handleSignalOffer(payload) {
    const tunnel = this.tunnels.get(payload.connectionId);
    if (tunnel === undefined || payload.targetDeviceId !== this.identity.deviceId) {
      this.logger.warn("stale webrtc offer ignored", { connectionId: shortId(payload.connectionId) });
      return;
    }
    if (tunnel.channel !== undefined || tunnel.rtc !== undefined) {
      this.logger.warn("duplicate webrtc offer ignored", { connectionId: shortId(tunnel.connectionId) });
      return;
    }
    if (this.config.forceRelay) {
      this.logger.warn("webrtc offer ignored: forceRelay is enabled", { connectionId: shortId(tunnel.connectionId) });
      return;
    }
    if (this.rtcFactory === undefined && this.rtcFactoryProvider !== undefined) {
      this.rtcFactory = await this.rtcFactoryProvider().catch(() => {
        return;
      });
    }
    if (this.rtcFactory === undefined) {
      this.logger.warn("webrtc offer ignored: no RTC backend available", { connectionId: shortId(tunnel.connectionId) });
      return;
    }
    let iceServers = [];
    try {
      iceServers = await this.api.turnCredentials(tunnel.connectionId);
    } catch (error) {
      this.logger.warn("TURN credentials unavailable; trying direct candidates", {
        connectionId: shortId(tunnel.connectionId),
        code: errorCode(error)
      });
    }
    if (this.stopped || this.tunnels.get(tunnel.connectionId) !== tunnel || tunnel.rtc !== undefined || tunnel.channel !== undefined || tunnel.transport !== "negotiating")
      return;
    if (!tunnel.preferredTransports.includes("turn"))
      iceServers = stunOnlyIceServers(iceServers);
    const rtc = new RtcDataChannelTransport({
      role: "responder",
      factory: this.rtcFactory,
      iceServers,
      onSignal: (signal) => this.sendRtcSignal(tunnel, signal),
      negotiateTimeoutMs: this.webRtcNegotiateTimeoutMs,
      label: `host<-${tunnel.peer.deviceId}`,
      onDiagnostic: (event) => {
        if (event.type !== "local-candidate-filtered" && event.type !== "candidate-pair-filtered")
          return;
        this.logger.debug("webrtc candidate filtered", {
          connectionId: shortId(tunnel.connectionId),
          peerDeviceId: shortId(tunnel.peer.deviceId),
          type: event.type,
          reason: event.reason,
          candidate: event.type === "local-candidate-filtered" ? event.candidate : event.localCandidate
        });
      }
    });
    tunnel.rtc = rtc;
    rtc.onMessage((data) => tunnel.channel?.receive(undefined, data));
    rtc.onClose(() => {
      this.handleRtcFailed(tunnel, rtc, new Error("WebRTC data channel closed."));
    });
    rtc.connect().then(() => {
      this.handleRtcOpened(tunnel, rtc.selectedTransport() ?? "p2p");
    }).catch((error) => {
      this.handleRtcFailed(tunnel, rtc, asError2(error));
    });
    rtc.handleSignal({ type: "offer", sdp: payload.sdp });
    const buffered = tunnel.pendingIce;
    if (buffered !== undefined) {
      tunnel.pendingIce = undefined;
      for (const candidate of buffered)
        rtc.handleSignal({ type: "ice", candidate });
    }
  }
  handleSignalIce(payload) {
    if (!this.canUseWebRtc()) {
      throw new ControlConnectionError("INVALID_MESSAGE", "Server forwarded WebRTC signaling without negotiating it.");
    }
    const tunnel = this.tunnels.get(payload.connectionId);
    if (tunnel === undefined || payload.targetDeviceId !== this.identity.deviceId)
      return;
    const rtc = tunnel.rtc;
    if (rtc !== undefined) {
      rtc.handleSignal({ type: "ice", candidate: payload.candidate });
      return;
    }
    if (tunnel.channel === undefined)
      (tunnel.pendingIce ??= []).push(payload.candidate);
  }
  async handleTransportSelected(payload) {
    const tunnel = this.tunnels.get(payload.connectionId);
    if (tunnel === undefined || payload.targetDeviceId !== this.identity.deviceId) {
      this.logger.warn("stale transport selection ignored", { connectionId: shortId(payload.connectionId) });
      return;
    }
    if (tunnel.channel !== undefined) {
      if (tunnel.transport !== payload.transport) {
        this.logger.warn("late transport selection ignored", {
          connectionId: shortId(tunnel.connectionId),
          selected: payload.transport
        });
      }
      return;
    }
    const requiredCapability = `transport.${payload.transport}`;
    if (!this.negotiatedCapabilities.includes(requiredCapability)) {
      throw new ControlConnectionError("INVALID_MESSAGE", `Client selected unnegotiated transport: ${payload.transport}`);
    }
    if (payload.transport === "relay") {
      const rtc = tunnel.rtc;
      tunnel.rtc = undefined;
      tunnel.transport = "relay";
      tunnel.transportMode = undefined;
      await rtc?.close();
      if (tunnel.relayAssignment !== undefined) {
        try {
          await this.openDataSocket(tunnel);
        } catch (error) {
          this.logger.warn("relay data attach failed", {
            connectionId: shortId(tunnel.connectionId),
            peerDeviceId: shortId(tunnel.peer.deviceId),
            reason: diagnosticReason(error)
          });
          await this.dropTunnel(tunnel.connectionId, "CONNECTION_FAILED");
          this.sendControl("error", {
            code: "CONNECTION_FAILED",
            message: "Relay data connection failed.",
            retryable: true,
            connectionId: tunnel.connectionId
          });
          return;
        }
      }
      await this.resumePendingHandshake(tunnel);
      return;
    }
    if (tunnel.rtc === undefined) {
      throw new ControlConnectionError("INVALID_MESSAGE", "Client selected WebRTC before creating a data channel.");
    }
    tunnel.transport = payload.transport;
    tunnel.transportMode = tunnel.rtc.selectedPathMode();
    if (payload.turnNode !== undefined) {
      this.logger.info("client selected a turn relay", {
        connectionId: shortId(tunnel.connectionId),
        peerDeviceId: shortId(tunnel.peer.deviceId),
        turnNode: TURN_NODE_TEXT.test(payload.turnNode) ? payload.turnNode : "<invalid>"
      });
    }
    await this.resumePendingHandshake(tunnel);
  }
  canUseWebRtc() {
    return this.negotiatedCapabilities.includes("transport.lan") || this.negotiatedCapabilities.includes("transport.p2p") || this.negotiatedCapabilities.includes("transport.turn");
  }
  sendRtcSignal(tunnel, signal) {
    if (signal.type === "answer") {
      this.sendControl("signal.answer", {
        connectionId: tunnel.connectionId,
        targetDeviceId: tunnel.peer.deviceId,
        sdp: signal.sdp
      });
    } else if (signal.type === "ice") {
      this.sendControl("signal.ice", {
        connectionId: tunnel.connectionId,
        targetDeviceId: tunnel.peer.deviceId,
        candidate: signal.candidate
      });
    }
  }
  handleRtcOpened(tunnel, selected) {
    if (this.tunnels.get(tunnel.connectionId) !== tunnel || tunnel.rtc === undefined)
      return;
    const wireSelected = selected === "lan" && !this.negotiatedCapabilities.includes("transport.lan") && this.negotiatedCapabilities.includes("transport.p2p") ? "p2p" : selected;
    const requiredCapability = wireSelected === "lan" ? "transport.lan" : wireSelected === "turn" ? "transport.turn" : "transport.p2p";
    if (!this.negotiatedCapabilities.includes(requiredCapability)) {
      const error = new Error(`WebRTC selected unnegotiated transport: ${selected}`);
      if (!this.negotiatedCapabilities.includes("transport.relay")) {
        this.dropTunnel(tunnel.connectionId, "CONNECTION_FAILED");
        return;
      }
      this.handleRtcFailed(tunnel, tunnel.rtc, error);
      return;
    }
    tunnel.transport = wireSelected;
    tunnel.transportMode = tunnel.rtc.selectedPathMode();
    this.sendTransportSelected(tunnel, wireSelected);
    const diagnostics = rtcDiagnostics(tunnel.rtc);
    this.logger.info("webrtc data channel ready", {
      connectionId: shortId(tunnel.connectionId),
      peerDeviceId: shortId(tunnel.peer.deviceId),
      transport: tunnel.transportMode ?? wireSelected
    });
    if (diagnostics !== undefined) {
      this.logger.debug("webrtc data channel diagnostics", {
        connectionId: shortId(tunnel.connectionId),
        ...webrtcDiagnosticsLogFields(diagnostics)
      });
    }
    this.resumePendingHandshake(tunnel).catch((error) => {
      this.logger.warn("pending secure handshake failed", {
        connectionId: shortId(tunnel.connectionId),
        reason: diagnosticReason(error)
      });
      this.dropTunnel(tunnel.connectionId, "SECURE_CHANNEL_FAILED");
    });
  }
  async handleRtcFailed(tunnel, rtc, error) {
    if (this.tunnels.get(tunnel.connectionId) !== tunnel || tunnel.rtc !== rtc)
      return;
    const diagnostics = rtcDiagnostics(rtc);
    if (tunnel.transport === "lan" || tunnel.transport === "p2p" || tunnel.transport === "turn") {
      this.logger.warn("webrtc data channel failed; disconnecting peer", {
        connectionId: shortId(tunnel.connectionId),
        reason: diagnosticReason(error)
      });
      if (diagnostics !== undefined) {
        this.logger.debug("webrtc data channel failure diagnostics", {
          connectionId: shortId(tunnel.connectionId),
          ...webrtcDiagnosticsLogFields(diagnostics)
        });
      }
      await this.dropTunnel(tunnel.connectionId, "CONNECTION_FAILED");
      return;
    }
    tunnel.rtc = undefined;
    tunnel.transport = "relay";
    await rtc.close();
    this.logger.warn("webrtc negotiation failed; falling back to relay", {
      connectionId: shortId(tunnel.connectionId),
      reason: diagnosticReason(error)
    });
    if (diagnostics !== undefined) {
      this.logger.debug("webrtc negotiation failure diagnostics", {
        connectionId: shortId(tunnel.connectionId),
        ...webrtcDiagnosticsLogFields(diagnostics)
      });
    }
    await this.resumePendingHandshake(tunnel);
  }
  sendTransportSelected(tunnel, transport) {
    this.sendControl("transport.selected", {
      connectionId: tunnel.connectionId,
      targetDeviceId: tunnel.peer.deviceId,
      transport
    });
  }
  async sendRelay(tunnel, ciphertext) {
    if (this.tunnels.get(tunnel.connectionId) !== tunnel || tunnel.channel === undefined) {
      throw new Error("Relay tunnel closed");
    }
    const counter = Number(tunnel.noise.sendingCounter() - 1n);
    if (!Number.isSafeInteger(counter) || counter < 0)
      throw new ControlConnectionError("FRAME_TOO_LARGE", "Noise transport counter overflowed.");
    const socket = tunnel.dataSocket ?? this.socket;
    if (socket === undefined)
      throw new Error("Relay transport closed");
    await waitForRelayCapacity(socket);
    if (this.tunnels.get(tunnel.connectionId) !== tunnel || tunnel.channel === undefined) {
      throw new Error("Relay tunnel closed");
    }
    if (tunnel.dataSocket !== undefined) {
      if (tunnel.dataSocket !== socket || tunnel.dataSocket.readyState !== 1 || !tunnel.dataReady) {
        throw new Error("Relay data transport is not ready");
      }
      socket.send(encodeRelayDataFrame(createRelayDataFrame("relay", {
        connectionId: tunnel.connectionId,
        targetDeviceId: tunnel.peer.deviceId,
        counter,
        ciphertext: toBase64Url(ciphertext)
      }), this.controlFrameLimits));
      return;
    }
    if (this.socket !== socket)
      throw new Error("Relay transport replaced");
    this.sendControl("relay", {
      connectionId: tunnel.connectionId,
      targetDeviceId: tunnel.peer.deviceId,
      counter,
      ciphertext: toBase64Url(ciphertext)
    });
  }
  async openDataSocket(tunnel) {
    const assignment = tunnel.relayAssignment;
    if (assignment === undefined || tunnel.dataSocket !== undefined)
      return;
    if (typeof assignment.relayEndpoint !== "string" || typeof assignment.relayTicket !== "string")
      return;
    const socket = this.createWebSocket(assignment.relayEndpoint);
    socket.binaryType = "arraybuffer";
    tunnel.dataSocket = socket;
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error("Relay data attach timed out")), 15000);
      const finish = (error) => {
        if (settled)
          return;
        settled = true;
        clearTimeout(timer);
        if (error === undefined)
          resolve();
        else
          reject(error);
      };
      socket.onopen = () => {
        try {
          socket.send(encodeRelayDataFrame(createRelayDataFrame("relay.attach", {
            connectionId: tunnel.connectionId,
            deviceId: this.identity.deviceId,
            peerDeviceId: tunnel.peer.deviceId,
            ticket: assignment.relayTicket
          }), this.controlFrameLimits));
        } catch (error) {
          finish(asError2(error));
        }
      };
      socket.onmessage = (event) => {
        try {
          if (typeof event.data !== "string")
            throw new ControlConnectionError("INVALID_MESSAGE", "Relay data frames must be text JSON.");
          const frame = decodeRelayDataFrame(event.data, this.controlFrameLimits);
          if (frame.type === "relay.ready") {
            if (frame.payload.connectionId !== tunnel.connectionId || assignment.relayEpoch !== undefined && frame.payload.epoch !== assignment.relayEpoch) {
              throw new ControlConnectionError("INVALID_MESSAGE", "Relay data attach does not match the assigned connection.");
            }
            tunnel.dataReady = true;
            finish();
            return;
          }
          this.handleDataSocketFrame(tunnel, frame.type, frame.payload).catch((error) => {
            finish(asError2(error));
            this.dropTunnel(tunnel.connectionId, "CONNECTION_FAILED");
          });
        } catch (error) {
          finish(asError2(error));
          this.dropTunnel(tunnel.connectionId, "CONNECTION_FAILED");
        }
      };
      socket.onerror = () => finish(new Error("Relay data socket failed"));
      socket.onclose = () => {
        if (!tunnel.dataReady)
          finish(new Error("Relay data socket closed before attach"));
        else
          this.dropTunnel(tunnel.connectionId, "CONNECTION_FAILED");
      };
    });
  }
  async handleDataSocketFrame(tunnel, type, payload) {
    if (this.tunnels.get(tunnel.connectionId) !== tunnel)
      return;
    if (type === "relay.detach") {
      await this.dropTunnel(tunnel.connectionId, "CONNECTION_FAILED");
      return;
    }
    if (type === "ping") {
      if (tunnel.dataSocket?.readyState === 1) {
        tunnel.dataSocket.send(encodeRelayDataFrame(createRelayDataFrame("pong", payload), this.controlFrameLimits));
      }
      return;
    }
    if (type !== "relay")
      throw new ControlConnectionError("INVALID_MESSAGE", `Unexpected Relay data frame: ${type}`);
    await this.handleRelay(requireRelay(payload));
  }
  sendControl(type, payload) {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== 1)
      throw new ControlConnectionError("CONNECTION_FAILED", "Server control socket is not open.");
    socket.send(encodeControlFrame(createControlFrame(type, payload), this.controlFrameLimits));
  }
  notifyTunnelClosed(tunnel) {
    if (!tunnel.lease || this.socket?.readyState !== 1)
      return;
    try {
      this.sendControl("connection.lease.close", { connectionId: tunnel.connectionId });
    } catch {}
  }
  async dropTunnels() {
    const tunnels = [...this.tunnels.values()];
    this.tunnels.clear();
    await Promise.all(tunnels.map(async (tunnel) => {
      tunnel.lease?.stop();
      if (tunnel.rtc !== undefined)
        await tunnel.rtc.close();
      tunnel.dataSocket?.close();
      if (tunnel.channel !== undefined)
        await tunnel.channel.close();
      else
        tunnel.noise.destroy();
    }));
    await this.connections.close();
  }
  async dropTunnel(connectionId, code, detail) {
    const tunnel = this.tunnels.get(connectionId);
    if (tunnel === undefined)
      return;
    this.notifyTunnelClosed(tunnel);
    this.tunnels.delete(connectionId);
    tunnel.lease?.stop();
    try {
      await tunnel.rtc?.close();
    } catch (error) {
      this.logger.warn("remote connection RTC cleanup failed", {
        connectionId: shortId(connectionId),
        reason: diagnosticReason(error)
      });
    }
    tunnel.dataSocket?.close();
    tunnel.dataSocket = undefined;
    tunnel.dataReady = false;
    if (tunnel.channel !== undefined) {
      try {
        const closed = detail === undefined ? await this.connections.closeConnection(connectionId, code) : await this.connections.closeConnection(connectionId, code, detail);
        if (!closed)
          await tunnel.channel.close(code);
      } catch (error) {
        await tunnel.channel.close(code).catch(() => {
          return;
        });
        this.logger.warn("remote connection channel cleanup failed", {
          connectionId: shortId(connectionId),
          reason: diagnosticReason(error)
        });
      }
    } else {
      tunnel.noise.destroy();
    }
  }
  waitBeforeRetry() {
    const delay = Math.round(Math.random() * this.config.reconnect.maxDelayMs);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.retryWake = undefined;
        resolve();
      }, delay);
      this.retryWake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
var TERMINAL_AUTH_ERRORS = new Set([
  "CONNECTION_REPLACED",
  "ACCOUNT_AUTH_REQUIRED",
  "AUTH_INVALID",
  "DEVICE_OWNERSHIP_REQUIRED",
  "DEVICE_REVOKED",
  "TOKEN_EXPIRED"
]);

class ServerNoiseChannel {
  tunnel;
  transmit;
  onClose;
  sends = new SerialSend;
  security;
  peerDeviceId;
  peerIdentityKey;
  mode;
  handlers = new Set;
  incoming = new SecureMessageCodec;
  outgoing = new SecureMessageCodec;
  closed = false;
  sendTail = Promise.resolve();
  constructor(tunnel, transmit, onClose, mode) {
    this.tunnel = tunnel;
    this.transmit = transmit;
    this.onClose = onClose;
    this.mode = mode;
    this.security = {
      protocol: "Noise_IK_25519_ChaChaPoly_SHA256",
      connectionId: tunnel.connectionId,
      membershipId: tunnel.membershipId
    };
    this.peerDeviceId = tunnel.peer.deviceId;
    this.peerIdentityKey = tunnel.peer.publicKey;
  }
  async send(message) {
    const run = this.sendTail.then(() => this.sendNow(message));
    this.sendTail = run.catch(() => {
      return;
    });
    return run;
  }
  async sendNow(message) {
    if (this.tunnel.lease && !this.tunnel.lease.valid())
      throw new Error("Control lease expired");
    if (this.closed)
      throw new Error("secure channel is closed");
    const encoded = encodeMessage(message);
    try {
      await this.sends.run(encoded.byteLength, async () => {
        if (this.closed)
          throw new Error("Secure channel closed");
        for (const plaintext of this.outgoing.encode(encoded)) {
          if (this.closed)
            throw new Error("Secure channel closed");
          await this.transmit(this.tunnel.noise.encrypt(plaintext));
        }
      });
    } catch (error) {
      await this.close().catch(() => {
        return;
      });
      throw error;
    }
  }
  onMessage(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  receive(counter, ciphertext) {
    if (this.tunnel.lease && !this.tunnel.lease.valid())
      return;
    if (this.closed)
      return;
    if (counter !== undefined) {
      const expected = Number(this.tunnel.noise.receivingCounter());
      if (!Number.isSafeInteger(counter) || counter !== expected) {
        throw new ControlConnectionError("INVALID_MESSAGE", "Relay counter is duplicated or out of order.");
      }
    }
    const plaintext = this.incoming.decode(this.tunnel.noise.decrypt(ciphertext));
    if (plaintext === undefined)
      return;
    const message = decodeMessage(plaintext);
    for (const handler of this.handlers)
      handler(message);
  }
  async close(_code) {
    if (this.closed)
      return;
    this.closed = true;
    this.handlers.clear();
    this.incoming.reset();
    this.outgoing.reset();
    this.tunnel.noise.destroy();
    await this.onClose();
  }
}

class ControlConnectionError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function websocketUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/v1/connect`;
  return url.toString();
}
function decodeControl(data, limits) {
  if (typeof data !== "string")
    throw new ControlConnectionError("INVALID_MESSAGE", "Server control frames must be text JSON.");
  try {
    return decodeControlFrame(data, limits);
  } catch {
    throw new ControlConnectionError("INVALID_MESSAGE", "Server sent an invalid control frame.");
  }
}
function requireHelloAck(value) {
  const payload = requireObject(value);
  if (payload.protocol !== PROTOCOL_VERSION || typeof payload.serverVersion !== "string" || typeof payload.connectionSessionId !== "string" || !Number.isSafeInteger(payload.heartbeatIntervalMs) || payload.heartbeatIntervalMs <= 0 || !Number.isSafeInteger(payload.maxControlFrameBytes) || !Number.isSafeInteger(payload.maxRelayFrameBytes)) {
    throw new ControlConnectionError("INVALID_MESSAGE", "hello.ack payload is invalid.");
  }
  return payload;
}
function requireConnectIncoming(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.clientDeviceId !== "string" || typeof payload.clientIdentityKey !== "string" || payload.authorization !== "account" || !Array.isArray(payload.preferredTransports)) {
    throw new ControlConnectionError("INVALID_MESSAGE", "connect.incoming payload is invalid.");
  }
  return payload;
}
function requireHandshake(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.targetDeviceId !== "string" || !Number.isSafeInteger(payload.step) || typeof payload.data !== "string") {
    throw new ControlConnectionError("INVALID_MESSAGE", "secure.handshake payload is invalid.");
  }
  return payload;
}
function requireRelay(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.targetDeviceId !== "string" || !Number.isSafeInteger(payload.counter) || typeof payload.ciphertext !== "string") {
    throw new ControlConnectionError("INVALID_MESSAGE", "relay payload is invalid.");
  }
  return payload;
}
function requireSignal(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.targetDeviceId !== "string" || typeof payload.sdp !== "string" || payload.sdp.length === 0) {
    throw new ControlConnectionError("INVALID_MESSAGE", "signal offer/answer payload is invalid.");
  }
  return payload;
}
function requireSignalIce(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.targetDeviceId !== "string" || typeof payload.candidate !== "object" || payload.candidate === null || Array.isArray(payload.candidate)) {
    throw new ControlConnectionError("INVALID_MESSAGE", "signal.ice payload is invalid.");
  }
  return payload;
}
function requireTransportSelected(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.targetDeviceId !== "string" || payload.transport !== "lan" && payload.transport !== "p2p" && payload.transport !== "turn" && payload.transport !== "relay") {
    throw new ControlConnectionError("INVALID_MESSAGE", "transport.selected payload is invalid.");
  }
  return payload;
}
function requireControlError(value) {
  const payload = requireObject(value);
  if (typeof payload.code !== "string" || typeof payload.message !== "string" || payload.connectionId !== undefined && (typeof payload.connectionId !== "string" || payload.connectionId === "")) {
    throw new ControlConnectionError("INVALID_MESSAGE", "error payload is invalid.");
  }
  return payload;
}
function requireObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ControlConnectionError("INVALID_MESSAGE", "Control payload must be an object.");
  }
  return value;
}
function objectValue(value, key) {
  return requireObject(value)[key];
}
function shortId(value) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
var TURN_NODE_TEXT = /^[A-Za-z0-9.[\]:-]+$/;
function asError2(error) {
  return error instanceof Error ? error : new Error("Unknown Server connection error.");
}
function diagnosticReason(error) {
  const message = asError2(error).message.replace(/[\r\n]+/g, " ").slice(0, 160);
  return message || "Unknown Server connection error.";
}
function webrtcDiagnosticsLogFields(diagnostics) {
  if (diagnostics === undefined)
    return {};
  return {
    rtcConnectionState: diagnostics.connectionState,
    rtcIceConnectionState: diagnostics.iceConnectionState,
    rtcIceGatheringState: diagnostics.iceGatheringState,
    rtcLocalCandidates: diagnostics.localCandidates,
    rtcRemoteCandidates: diagnostics.remoteCandidates,
    rtcCandidatePairs: diagnostics.candidatePairs,
    rtcFilteredLocalCandidates: diagnostics.filteredLocalCandidates,
    rtcFilteredCandidatePairs: diagnostics.filteredCandidatePairs,
    ...diagnostics.selectedPath === undefined ? {} : { rtcSelectedPath: diagnostics.selectedPath }
  };
}
function rtcDiagnostics(rtc) {
  try {
    const candidate = rtc;
    return typeof candidate.diagnostics === "function" ? candidate.diagnostics() : undefined;
  } catch {
    return;
  }
}
function errorCode(error) {
  return error instanceof ServerApiError || error instanceof ControlConnectionError ? error.code : "CONNECTION_FAILED";
}
function isRetryable(error) {
  return errorCode(error) !== "UNSUPPORTED_VERSION" && !TERMINAL_AUTH_ERRORS.has(errorCode(error)) && (!(error instanceof ServerApiError) || error.retryable);
}
function closeCode(code) {
  if (code === 4002)
    return "AUTH_INVALID";
  if (code === 4003)
    return "CONNECTION_REPLACED";
  if (code === 4004)
    return "DEVICE_REVOKED";
  if (code === 4007)
    return "RATE_LIMITED";
  if (code === 4011)
    return "UNSUPPORTED_VERSION";
  return "CONNECTION_FAILED";
}
// packages/plugin/src/connection-controller.ts
class ConnectionController {
  identities;
  createRouter;
  logger;
  active = new Map;
  acceptQueue = Promise.resolve();
  constructor(identities, createRouter, logger) {
    this.identities = identities;
    this.createRouter = createRouter;
    this.logger = logger;
  }
  accept(channel) {
    const operation = this.acceptQueue.then(() => this.acceptOne(channel));
    this.acceptQueue = operation.catch(() => {
      return;
    });
    return operation;
  }
  async acceptOne(channel) {
    if (channel.security?.protocol !== "Noise_IK_25519_ChaChaPoly_SHA256" || channel.security.connectionId === "" || channel.security.membershipId === "") {
      await channel.close("SECURE_CHANNEL_FAILED");
      throw new ConnectionRejectedError("SECURE_CHANNEL_FAILED", "The channel is missing its authenticated Noise or membership context.");
    }
    if (!this.identities.isTrusted(channel.peerDeviceId, channel.peerIdentityKey)) {
      await channel.close("PEER_IDENTITY_MISMATCH");
      throw new ConnectionRejectedError("PEER_IDENTITY_MISMATCH", "The peer identity does not match local trust.");
    }
    const connectionId = channel.security.connectionId;
    const connectionConflict = this.active.get(connectionId);
    if (connectionConflict !== undefined && connectionConflict.channel.peerDeviceId !== channel.peerDeviceId) {
      await channel.close("SECURE_CHANNEL_FAILED");
      throw new ConnectionRejectedError("SECURE_CHANNEL_FAILED", "The connection id is already bound to another peer.");
    }
    const replaced = [...this.active.values()].filter((connection) => connection.channel.peerDeviceId === channel.peerDeviceId || connection.channel.security.connectionId === connectionId);
    if (replaced.length > 0) {
      this.logger?.warn("replacing active peer connection", {
        peerDeviceId: shortId2(channel.peerDeviceId),
        replacedCount: replaced.length,
        replacedPeerDeviceIds: replaced.map((connection) => shortId2(connection.channel.peerDeviceId))
      });
    }
    await Promise.all(replaced.map((connection) => this.disconnect(connection, "CONNECTION_REPLACED")));
    const router = this.createRouter({ connectionId, peerDeviceId: channel.peerDeviceId, transportMode: () => channel.mode }, (message) => this.sendTo(connectionId, channel, message));
    const connection = {
      channel,
      router,
      unsubscribe: () => {
        return;
      }
    };
    this.active.set(connectionId, connection);
    try {
      connection.unsubscribe = channel.onMessage((message) => {
        this.handle(connection, message);
      });
    } catch (error) {
      await this.disconnect(connection);
      throw error;
    }
    this.logger?.info("peer connection accepted", {
      peerDeviceId: shortId2(channel.peerDeviceId),
      connectionId: shortId2(connectionId),
      mode: channel.mode
    });
  }
  isOnline() {
    return this.active.size > 0;
  }
  connectionCount() {
    return this.active.size;
  }
  peerDeviceIds() {
    return this.connectedPeers().map((peer) => peer.deviceId);
  }
  connectedPeers() {
    const peers = [];
    const seen = new Set;
    for (const connection of this.active.values()) {
      const deviceId = connection.channel.peerDeviceId;
      if (seen.has(deviceId))
        continue;
      seen.add(deviceId);
      peers.push({
        deviceId,
        ...connection.channel.mode === undefined ? {} : { mode: connection.channel.mode }
      });
    }
    return peers;
  }
  peerDeviceId() {
    const peers = this.peerDeviceIds();
    return peers.length === 1 ? peers[0] : undefined;
  }
  connectionMode() {
    const connection = this.active.values().next().value;
    return connection?.channel.mode ?? (connection === undefined ? "Disconnected" : "Relay");
  }
  async send(message) {
    await Promise.all([...this.active.values()].map((connection) => this.sendConnection(connection, message)));
  }
  async revoke(deviceId) {
    const revoked = [...this.active.values()].filter((connection) => connection.channel.peerDeviceId === deviceId);
    await Promise.all(revoked.map((connection) => this.disconnect(connection, "DEVICE_REVOKED")));
  }
  async closeConnection(connectionId, code, detail) {
    const connection = this.active.get(connectionId);
    if (connection === undefined)
      return false;
    await this.disconnect(connection, code, detail);
    return true;
  }
  async close() {
    await this.acceptQueue;
    await Promise.all([...this.active.values()].map((connection) => this.disconnect(connection)));
  }
  async handle(connection, message) {
    if (!this.isActive(connection))
      return;
    try {
      const response = await connection.router.handle(message);
      if (!this.isActive(connection))
        return;
      const responseBytes = encodeMessage(response).byteLength;
      let outbound;
      if (responseBytes <= MAX_SECURE_MESSAGE_BYTES) {
        outbound = response;
      } else {
        const endpoint = extractEndpoint(message);
        this.logger?.warn("host response exceeds secure channel", {
          endpoint,
          bytes: responseBytes,
          limit: MAX_SECURE_MESSAGE_BYTES
        });
        outbound = createRpcError(message.id, "RESPONSE_TOO_LARGE", "The Host response is too large for the secure Remote channel. Request a smaller page.", { maxBytes: MAX_SECURE_MESSAGE_BYTES }, true);
      }
      await connection.channel.send(outbound);
    } catch (error) {
      this.logger?.warn("peer message handling failed; disconnecting", {
        peerDeviceId: shortId2(connection.channel.peerDeviceId),
        reason: diagnosticReason2(error)
      });
      await this.disconnect(connection);
    }
  }
  async sendTo(connectionId, channel, message) {
    const connection = this.active.get(connectionId);
    if (connection === undefined || connection.channel !== channel) {
      throw new Error("peer channel is not active");
    }
    await this.sendConnection(connection, message);
  }
  async sendConnection(connection, message) {
    if (!this.isActive(connection)) {
      throw new Error("peer channel is not active");
    }
    try {
      await connection.channel.send(message);
    } catch (error) {
      this.logger?.warn("peer send failed; disconnecting", {
        peerDeviceId: shortId2(connection.channel.peerDeviceId),
        messageType: message.type,
        reason: diagnosticReason2(error)
      });
      await this.disconnect(connection);
      throw error instanceof Error ? error : new Error("peer send failed", { cause: error });
    }
  }
  async disconnect(connection, code, detail) {
    if (!this.isActive(connection))
      return;
    this.active.delete(connection.channel.security.connectionId);
    connection.unsubscribe();
    try {
      await connection.router.closePeerStreams();
    } finally {
      await connection.channel.close(code);
    }
    this.logger?.info("peer connection disconnected", {
      peerDeviceId: shortId2(connection.channel.peerDeviceId),
      connectionId: shortId2(connection.channel.security.connectionId),
      code: code ?? "closed",
      closedBy: detail?.closedBy ?? "host",
      ...detail?.retryable === undefined ? {} : { retryable: detail.retryable }
    });
  }
  isActive(connection) {
    return this.active.get(connection.channel.security.connectionId) === connection;
  }
}

class ConnectionRejectedError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function diagnosticReason2(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 160) || "Unknown peer connection failure.";
}
function extractEndpoint(message) {
  if (!isRecord(message) || !isRecord(message.payload))
    return;
  const payload = message.payload;
  if (isRecord(payload.params)) {
    if (typeof payload.params.endpoint === "string")
      return payload.params.endpoint;
    if (typeof payload.params.method === "string")
      return payload.params.method;
  }
  if (typeof payload.endpoint === "string")
    return payload.endpoint;
  if (typeof payload.method === "string")
    return payload.method;
  return;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function shortId2(value) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
// packages/plugin/src/identity-store.ts
import { createHash as createHash2 } from "node:crypto";
import { chmod as chmod2, lstat, mkdir as mkdir2, readFile as readFile2, readdir as readdir2, rename as rename2, rm as rm3, stat as stat2, unlink, writeFile as writeFile2 } from "node:fs/promises";
import { homedir } from "node:os";
import { basename as basename2, dirname as dirname2, join as join3 } from "node:path";
var identitySchema = object({
  schemaVersion: literal(1),
  deviceId: string2().uuid(),
  name: string2().min(1).max(80),
  publicKey: string2().min(1)
}).strict();
var trustedPeerSchema = object({
  deviceId: string2().min(1),
  name: string2().min(1).max(80),
  platform: string2().min(1).max(40),
  publicKey: string2().min(1),
  fingerprint: string2().min(1),
  trustedAt: number2().int().nonnegative(),
  membershipId: string2().min(1).optional()
}).strict();
var trustedPeersSchema = object({
  schemaVersion: literal(1),
  peers: array(trustedPeerSchema)
}).strict();
var STORAGE_CONFLICT_MESSAGE = "Remote storage ownership could not be verified; nothing was moved. Inspect the legacy directory manually.";
var STORAGE_CONFLICT_ENTRY_PATTERN = /^(?:device\.json|device\.key|trusted-peers\.json|server-credentials\.json|host-pairing\.json|pairing-host-only\.json)(?:\.bak(?:-[0-9]+)?|\.old|\.orig|~|\.swp)$/;

class IdentityInvalidError extends Error {
  code;
  constructor(message, code = "IDENTITY_INVALID") {
    super(message);
    this.code = code;
  }
}

class IdentityStore {
  storageDirectory;
  get directory() {
    return this.storageDirectory;
  }
  identity;
  peers = new Map;
  peerSaveChain = Promise.resolve();
  defaultOptions;
  role;
  constructor(options = {}) {
    const env = options.env ?? process.env;
    const dshHome = env.DSH_HOME || join3(options.homeDirectory ?? homedir(), ".dsh");
    this.storageDirectory = options.directory ?? join3(dshHome, "ds-harness-remote");
    this.defaultOptions = options.directory === undefined ? options : undefined;
    this.role = options.role;
  }
  async loadOrCreate(deviceName) {
    if (this.defaultOptions !== undefined)
      this.storageDirectory = await prepareDefaultIdentityDirectory(this.defaultOptions);
    await ensureDirectory(this.directory);
    return withIdentityLock(this.directory, () => this.loadOrCreateLocked(deviceName));
  }
  async loadExisting() {
    if (this.defaultOptions !== undefined)
      this.storageDirectory = await prepareDefaultIdentityDirectory(this.defaultOptions);
    const devicePath = join3(this.directory, "device.json");
    const keyPath = join3(this.directory, "device.key");
    const [hasDevice, hasKey] = await Promise.all([exists2(devicePath), exists2(keyPath)]);
    if (!hasDevice && !hasKey)
      return;
    if (hasDevice !== hasKey) {
      throw new IdentityInvalidError("device identity is incomplete; repair it explicitly before reconnecting");
    }
    await assertPrivateMode2(keyPath);
    try {
      const record = identitySchema.parse(JSON.parse(await readFile2(devicePath, "utf8")));
      const privateKey = (await readFile2(keyPath, "utf8")).trim();
      const regenerated = generateKeyPair(fromBase64Url(privateKey));
      if (regenerated.publicKey !== record.publicKey) {
        throw new IdentityInvalidError("device public and private keys do not match");
      }
      return { ...record, privateKey, fingerprint: fingerprint(record.publicKey) };
    } catch (error) {
      if (error instanceof IdentityInvalidError)
        throw error;
      throw new IdentityInvalidError(`device identity is invalid: ${safeErrorMessage(error)}`);
    }
  }
  async loadOrCreateLocked(deviceName) {
    const devicePath = join3(this.directory, "device.json");
    const keyPath = join3(this.directory, "device.key");
    const [hasDevice, hasKey] = await Promise.all([exists2(devicePath), exists2(keyPath)]);
    const isScopedOrExplicitClient = this.role === "client" || this.role === undefined && isScopedClientDirectory(this.directory);
    const isFlatRootWithScopedIdentity = !isScopedOrExplicitClient && this.role === undefined && await hasVerifiedScopedIdentity(this.directory);
    const isClientRole = isScopedOrExplicitClient || isFlatRootWithScopedIdentity;
    if (hasDevice !== hasKey) {
      if (isClientRole && await canAutoHealClientIdentity(this.directory, isFlatRootWithScopedIdentity)) {
        await removeIdentityRecords(this.directory);
        return this.createAndReadIdentityLocked(devicePath, keyPath, deviceName);
      }
      throw new IdentityInvalidError("device identity is incomplete; repair it explicitly before reconnecting");
    }
    if (!hasDevice) {
      return this.createAndReadIdentityLocked(devicePath, keyPath, deviceName);
    }
    let identity;
    try {
      identity = await this.readIdentity(devicePath, keyPath, deviceName);
    } catch (error) {
      if (error instanceof IdentityInvalidError && isClientRole && await canAutoHealClientIdentity(this.directory, isFlatRootWithScopedIdentity)) {
        await removeIdentityRecords(this.directory);
        return this.createAndReadIdentityLocked(devicePath, keyPath, deviceName);
      }
      throw error;
    }
    await removeStaleTemporaries(this.directory);
    return identity;
  }
  async createAndReadIdentityLocked(devicePath, keyPath, deviceName) {
    const keys = generateKeyPair();
    const record = { schemaVersion: 1, deviceId: uuidV7(), name: deviceName, publicKey: keys.publicKey };
    await atomicTextWrite(keyPath, `${keys.privateKey}
`, 384);
    await atomicJsonWrite(devicePath, record, 384);
    const identity = await this.readIdentity(devicePath, keyPath, deviceName);
    await removeStaleTemporaries(this.directory);
    return identity;
  }
  async readIdentity(devicePath, keyPath, deviceName) {
    await assertPrivateMode2(keyPath);
    try {
      let record = identitySchema.parse(JSON.parse(await readFile2(devicePath, "utf8")));
      const privateKey = (await readFile2(keyPath, "utf8")).trim();
      const regenerated = generateKeyPair(fromBase64Url(privateKey));
      if (regenerated.publicKey !== record.publicKey) {
        throw new IdentityInvalidError("device public and private keys do not match");
      }
      if (record.name !== deviceName) {
        record = { ...record, name: deviceName };
        await atomicJsonWrite(devicePath, record, 384);
      }
      this.identity = { ...record, privateKey, fingerprint: fingerprint(record.publicKey) };
      await this.loadPeers();
      return this.identity;
    } catch (error) {
      if (error instanceof IdentityInvalidError)
        throw error;
      throw new IdentityInvalidError(`device identity is invalid: ${safeErrorMessage(error)}`);
    }
  }
  current() {
    if (this.identity === undefined)
      throw new Error("identity store has not been loaded");
    return this.identity;
  }
  async reset(deviceName) {
    if (this.defaultOptions !== undefined)
      this.storageDirectory = await prepareDefaultIdentityDirectory(this.defaultOptions);
    await ensureDirectory(this.directory);
    return withIdentityLock(this.directory, async () => {
      await this.peerSaveChain.catch(() => {
        return;
      });
      this.identity = undefined;
      this.peers.clear();
      await removeIdentityRecords(this.directory);
      return this.loadOrCreateLocked(deviceName);
    });
  }
  listTrustedPeers() {
    return [...this.peers.values()].map((peer) => ({ ...peer }));
  }
  trustedPeer(deviceId) {
    const peer = this.peers.get(deviceId);
    return peer === undefined ? undefined : { ...peer };
  }
  isTrusted(deviceId, publicKey) {
    return this.peers.get(deviceId)?.publicKey === publicKey;
  }
  async trustPeer(input) {
    this.current();
    const peer = {
      ...input,
      fingerprint: fingerprint(input.publicKey),
      trustedAt: Date.now()
    };
    this.peers.set(peer.deviceId, peer);
    await this.savePeers();
    return { ...peer };
  }
  async revokePeer(deviceId) {
    const removed = this.peers.delete(deviceId);
    if (removed)
      await this.savePeers();
    return removed;
  }
  async loadPeers() {
    const path = join3(this.directory, "trusted-peers.json");
    if (!await exists2(path)) {
      await atomicJsonWrite(path, { schemaVersion: 1, peers: [] }, 384);
    }
    const parsed = trustedPeersSchema.parse(JSON.parse(await readFile2(path, "utf8")));
    const peers = new Map;
    for (const peer of parsed.peers) {
      if (peer.fingerprint !== fingerprint(peer.publicKey)) {
        throw new IdentityInvalidError(`trusted peer ${peer.deviceId} has an invalid fingerprint`);
      }
      if (peers.has(peer.deviceId))
        throw new IdentityInvalidError(`trusted peer ${peer.deviceId} is duplicated`);
      peers.set(peer.deviceId, peer);
    }
    this.peers = peers;
  }
  savePeers() {
    const next = this.peerSaveChain.catch(() => {
      return;
    }).then(() => atomicJsonWrite(join3(this.directory, "trusted-peers.json"), {
      schemaVersion: 1,
      peers: [...this.peers.values()]
    }, 384));
    this.peerSaveChain = next;
    return next;
  }
}
var statIdSchema = union([
  number2().int().nonnegative().transform((value) => BigInt(value)),
  string2().regex(/^(?:0|[1-9]\d{0,19})$/).transform((value) => BigInt(value))
]);
var legacyRootPinSchema = object({
  schemaVersion: literal(1),
  dev: statIdSchema,
  ino: statIdSchema
}).strict();
function serializeStatId(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}
async function prepareDefaultIdentityDirectory(options = {}) {
  if (options.directory !== undefined)
    return options.directory;
  return withDefaultStorageTransaction(options, prepareDefaultIdentityDirectoryLocked);
}
async function withDefaultStorageTransaction(options, operation) {
  const env = options.env ?? process.env;
  const home = env.DSH_HOME || join3(options.homeDirectory ?? homedir(), ".dsh");
  const source = join3(home, "remote");
  const target = join3(home, "ds-harness-remote");
  await mkdir2(home, { recursive: true, mode: 448 });
  const lockDirectory = join3(home, ".ds-harness-remote-migration");
  await storageDirectoryStat(lockDirectory);
  await ensureDirectory(lockDirectory);
  return withIdentityLock(lockDirectory, () => withDefaultCredentialMigrationGate(home, () => operation({ source, target, lockDirectory })));
}
async function prepareDefaultIdentityDirectoryLocked({ source, target, lockDirectory }) {
  const old = await storageDirectoryStat(source);
  const current = await storageDirectoryStat(target);
  const pinPath = join3(lockDirectory, "legacy-root.json");
  const pinMetadata = await lstat(pinPath).catch((error) => {
    if (isNodeError(error) && error.code === "ENOENT")
      return;
    throw error;
  });
  let pin;
  if (pinMetadata !== undefined) {
    if (!pinMetadata.isFile() || pinMetadata.isSymbolicLink() || pinMetadata.nlink !== 1 || pinMetadata.size > 4096) {
      throw new IdentityInvalidError("Remote storage fallback record is invalid; no credentials were changed.", "STORAGE_CONFLICT");
    }
    await assertPrivateMode2(pinPath);
    try {
      pin = legacyRootPinSchema.parse(JSON.parse(await readFile2(pinPath, "utf8")));
    } catch {
      throw new IdentityInvalidError("Remote storage fallback record is invalid; no credentials were changed.", "STORAGE_CONFLICT");
    }
  }
  if (old !== undefined) {
    if (current !== undefined) {
      throw new IdentityInvalidError("Both Remote storage directories exist; stop all Harness instances and resolve them manually. No credentials were overwritten.", "STORAGE_CONFLICT");
    }
    await assertOwnedRemoteStorage(source);
    await assertStorageIdle(source);
    if (pin !== undefined) {
      if (pin.dev !== old.dev || pin.ino !== old.ino) {
        throw new IdentityInvalidError("Legacy Remote storage changed after fallback; inspect it before reconnecting.", "STORAGE_CONFLICT");
      }
      return source;
    }
    try {
      await rename2(source, target);
    } catch (error) {
      if (!isNodeError(error) || !["EACCES", "EPERM", "EBUSY", "EXDEV", "EROFS", "EEXIST", "ENOTEMPTY", "ENOSPC", "EDQUOT"].includes(error.code ?? ""))
        throw error;
      const remaining = await storageDirectoryStat(source);
      if (remaining === undefined || remaining.dev !== old.dev || remaining.ino !== old.ino || await storageDirectoryStat(target) !== undefined)
        throw error;
      await assertOwnedRemoteStorage(source);
      await assertStorageIdle(source);
      await atomicJsonWrite(pinPath, {
        schemaVersion: 1,
        dev: serializeStatId(old.dev),
        ino: serializeStatId(old.ino)
      }, 384);
      return source;
    }
  } else if (pin !== undefined) {
    if (current === undefined)
      throw new IdentityInvalidError("Pinned Remote storage is missing; no replacement identity was created.", "STORAGE_CONFLICT");
    await assertOwnedRemoteStorage(target);
  }
  return target;
}
async function assertOwnedRemoteStorage(root) {
  let failureCode = "STORAGE_CONFLICT";
  const rejected = (code = failureCode, entryName) => new IdentityInvalidError(entryName === undefined ? STORAGE_CONFLICT_MESSAGE : `${STORAGE_CONFLICT_MESSAGE} Unexpected entry "${safeStorageEntryName(entryName)}" was found.`, code);
  const identityFiles = new Set([
    "device.json",
    "device.key",
    "trusted-peers.json",
    "server-credentials.json",
    "server-credentials.json.refresh-lock",
    "host-pairing.json",
    "pairing-host-only.json"
  ]);
  let identities = 0;
  let verifiedScopedIdentities = 0;
  const checkIdentity = async (directory, scope, role) => {
    const canAutoHeal = role === "client" || directory === root && verifiedScopedIdentities > 0;
    const entries = (await readStorageEntries(directory)).filter((entry) => !(directory === root && entry.name === "servers" && entry.isDirectory()));
    for (const entry of entries) {
      if (entry.name.includes(".refresh-lock") && entry.name !== "server-credentials.json.refresh-lock" && !isRefreshQueueArtifact(entry.name)) {
        if (entry.isSymbolicLink())
          throw rejected("STORAGE_CONFLICT");
        throw new IdentityInvalidError("Remote storage contains a lock or symbolic link; stop all Harness instances and inspect it before migration.", "IDENTITY_LOCKED");
      }
      if (isLockArtifact(entry.name)) {
        const lockPath = join3(directory, entry.name);
        const metadata = await lstat(lockPath);
        if (!entry.isFile() || !metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 16 * 1024 * 1024) {
          throw rejected("STORAGE_CONFLICT");
        }
        if (!await isExitedLockArtifact(lockPath)) {
          throw new IdentityInvalidError("Remote storage contains a lock or symbolic link; stop all Harness instances and inspect it before migration.", "IDENTITY_LOCKED");
        }
        continue;
      }
      const allowedFile = identityFiles.has(entry.name) || isOwnedTempArtifact(entry.name) || isRefreshQueueArtifact(entry.name) || isBackupArtifact(entry.name) || canAutoHeal && isIdentityTempArtifact(entry.name);
      if (!entry.isFile() || !allowedFile)
        throw rejected("STORAGE_CONFLICT", entry.name);
      const metadata = await lstat(join3(directory, entry.name));
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 * 1024 || metadata.nlink !== 1 && !await isVerifiedRefreshHardlink(directory, entry.name, entries.map((item) => item.name))) {
        throw rejected("STORAGE_CONFLICT", entry.name);
      }
    }
    const names = new Set(entries.map((entry) => entry.name).filter((name) => !isLockArtifact(name)));
    if (names.has("server-credentials.json.refresh-lock") && await readFile2(join3(directory, "server-credentials.json.refresh-lock"), "utf8") !== SERVER_CREDENTIALS_QUEUE_MARKER) {
      throw rejected("STORAGE_CONFLICT");
    }
    if (!names.has("device.json") && !names.has("device.key")) {
      if (canAutoHeal && await isRepairableLegacyClientDirectory(directory, names)) {
        if (names.size > 0)
          identities++;
        return;
      }
      throw rejected("STORAGE_CONFLICT");
    }
    failureCode = "IDENTITY_INVALID";
    if (!names.has("device.json") || !names.has("device.key")) {
      if (canAutoHeal && await isRepairableLegacyClientDirectory(directory, names)) {
        identities++;
        return;
      }
      throw rejected("IDENTITY_INVALID");
    }
    await assertPrivateMode2(join3(directory, "device.key"));
    let record;
    try {
      record = identitySchema.parse(JSON.parse(await readFile2(join3(directory, "device.json"), "utf8")));
      const key = (await readFile2(join3(directory, "device.key"), "utf8")).trim();
      if (generateKeyPair(fromBase64Url(key)).publicKey !== record.publicKey) {
        throw new IdentityInvalidError("device public and private keys do not match");
      }
    } catch {
      if (canAutoHeal && await isRepairableLegacyClientDirectory(directory, names)) {
        identities++;
        return;
      }
      throw rejected("IDENTITY_INVALID");
    }
    if (names.has("trusted-peers.json")) {
      const peers = trustedPeersSchema.parse(JSON.parse(await readFile2(join3(directory, "trusted-peers.json"), "utf8"))).peers;
      const ids = new Set;
      for (const peer of peers) {
        if (peer.fingerprint !== fingerprint(peer.publicKey) || ids.has(peer.deviceId))
          throw rejected("IDENTITY_INVALID");
        ids.add(peer.deviceId);
      }
    }
    if (names.has("server-credentials.json")) {
      const raw = JSON.parse(await readFile2(join3(directory, "server-credentials.json"), "utf8"));
      if (typeof raw.serverUrl !== "string")
        throw rejected("IDENTITY_INVALID");
      const expectedDeviceId = role === "client" && typeof raw.deviceId === "string" && string2().uuid().safeParse(raw.deviceId).success ? raw.deviceId : record.deviceId;
      const credentials = await new ServerCredentialStore(directory).load(raw.serverUrl, expectedDeviceId);
      if (credentials === undefined)
        throw rejected("IDENTITY_INVALID");
      const origin = new URL(credentials.serverUrl);
      if (!["http:", "https:"].includes(origin.protocol))
        throw rejected("IDENTITY_INVALID");
      if (scope !== undefined && createHash2("sha256").update(origin.origin).digest("hex").slice(0, 24) !== scope) {
        throw rejected("STORAGE_CONFLICT");
      }
    }
    if (names.has("pairing-host-only.json")) {
      await assertPrivateMode2(join3(directory, "pairing-host-only.json"));
      object({ hostOnly: literal(true) }).strict().parse(JSON.parse(await readFile2(join3(directory, "pairing-host-only.json"), "utf8")));
    }
    if (names.has("host-pairing.json")) {
      await assertPrivateMode2(join3(directory, "host-pairing.json"));
      const pairing = savedPairingSchema.parse(JSON.parse(await readFile2(join3(directory, "host-pairing.json"), "utf8")));
      if (pairing.deviceId !== record.deviceId || pairing.session.host.deviceId !== record.deviceId || pairing.session.host.identityKey !== record.publicKey || pairing.session.host.role !== "host")
        throw rejected("IDENTITY_INVALID");
      const origin = new URL(pairing.serverUrl);
      if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== pairing.serverUrl)
        throw rejected("IDENTITY_INVALID");
      if (scope !== undefined && createHash2("sha256").update(origin.origin).digest("hex").slice(0, 24) !== scope) {
        throw rejected("STORAGE_CONFLICT");
      }
    }
    identities++;
    if (scope !== undefined)
      verifiedScopedIdentities++;
  };
  try {
    const entries = await readStorageEntries(root);
    const servers = entries.find((entry) => entry.name === "servers");
    if (servers !== undefined) {
      if (!servers.isDirectory())
        throw rejected("STORAGE_CONFLICT", servers.name);
      for (const scope of await readStorageEntries(join3(root, "servers"))) {
        if (!scope.isDirectory() || !/^[a-f0-9]{24}$/.test(scope.name))
          throw rejected("STORAGE_CONFLICT", scope.name);
        for (const role of await readStorageEntries(join3(root, "servers", scope.name))) {
          if (!role.isDirectory() || role.name !== "host" && role.name !== "client")
            throw rejected("STORAGE_CONFLICT", role.name);
          await checkIdentity(join3(root, "servers", scope.name, role.name), scope.name, role.name);
        }
      }
    }
    const flat = entries.filter((entry) => entry.name !== "servers");
    if (flat.length > 0) {
      const unexpected = flat.find((entry) => {
        if (entry.name.includes(".refresh-lock"))
          return entry.isSymbolicLink();
        if (!entry.isFile())
          return true;
        return !identityFiles.has(entry.name) && !isOwnedTempArtifact(entry.name) && !isRefreshQueueArtifact(entry.name) && !isLockArtifact(entry.name) && !isBackupArtifact(entry.name) && !(verifiedScopedIdentities > 0 && isIdentityTempArtifact(entry.name));
      });
      if (unexpected !== undefined)
        throw rejected("STORAGE_CONFLICT", unexpected.name);
      await checkIdentity(root);
    }
    if (identities === 0)
      throw rejected(failureCode);
  } catch (error) {
    if (error instanceof IdentityInvalidError && (error.code === "STORAGE_CONFLICT" || error.code === "IDENTITY_LOCKED")) {
      throw error;
    }
    throw rejected(failureCode);
  }
}
async function isRepairableLegacyClientDirectory(directory, names) {
  for (const name of names) {
    if (name === "server-credentials.json" || name === "host-pairing.json" || name === "pairing-host-only.json" || name.startsWith("server-credentials.json.") || name.startsWith("host-pairing.json.") || name.startsWith("pairing-host-only.json.")) {
      return false;
    }
  }
  if (names.has("trusted-peers.json")) {
    const peers = trustedPeersSchema.parse(JSON.parse(await readFile2(join3(directory, "trusted-peers.json"), "utf8"))).peers;
    if (peers.length > 0)
      return false;
  }
  if (names.has("device.key")) {
    await assertPrivateMode2(join3(directory, "device.key"));
  }
  return true;
}
async function storageDirectoryStat(path) {
  try {
    const entry = await lstat(path, { bigint: true });
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new IdentityInvalidError("Remote storage must be a real directory; symbolic links are not migrated.", "STORAGE_CONFLICT");
    }
    return entry;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT")
      return;
    throw error;
  }
}
async function assertStorageIdle(directory) {
  const takeoverPaths = [];
  const lockPaths = [];
  const scan = async (currentDirectory) => {
    const before = await readdir2(currentDirectory, { withFileTypes: true });
    const names = before.map((entry) => entry.name);
    const linkedTemps = [];
    for (const entry of before) {
      if (!isRefreshQueueTemp(entry.name))
        continue;
      const metadata = await lstat(join3(currentDirectory, entry.name));
      if (metadata.nlink === 2 && await isVerifiedRefreshHardlink(currentDirectory, entry.name, names)) {
        linkedTemps.push(join3(currentDirectory, entry.name));
      }
    }
    try {
      await assertRefreshQueueIdle(currentDirectory);
    } catch (error) {
      if (!(error instanceof ServerCredentialsBusyError))
        throw error;
      throw new IdentityInvalidError("Remote storage has an active credential refresh; stop it before migration.", "IDENTITY_LOCKED");
    }
    for (const temporary of linkedTemps)
      await unlink(temporary);
    for (const entry of await readdir2(currentDirectory, { withFileTypes: true })) {
      const entryPath = join3(currentDirectory, entry.name);
      if (entry.name === "server-credentials.json.refresh-lock" && entry.isFile() && await readFile2(entryPath, "utf8") === SERVER_CREDENTIALS_QUEUE_MARKER)
        continue;
      if (entry.isFile() && isRefreshQueueArtifact(entry.name))
        continue;
      if (entry.isSymbolicLink()) {
        throw new IdentityInvalidError("Remote storage contains a lock or symbolic link; stop all Harness instances and inspect it before migration.", "STORAGE_CONFLICT");
      }
      if (entry.name === LOCK_FILE_NAME && entry.isFile()) {
        if (!await isExitedLockArtifact(entryPath)) {
          throw new IdentityInvalidError("Remote storage contains a lock or symbolic link; stop all Harness instances and inspect it before migration.", "IDENTITY_LOCKED");
        }
        lockPaths.push(entryPath);
        continue;
      }
      if (isTakeoverLockArtifact(entry.name) && entry.isFile()) {
        if (!await isExitedLockArtifact(entryPath)) {
          throw new IdentityInvalidError("Remote storage contains a lock or symbolic link; stop all Harness instances and inspect it before migration.", "IDENTITY_LOCKED");
        }
        takeoverPaths.push(entryPath);
        continue;
      }
      if (isOwnedTempArtifact(entry.name) && entry.isFile() && !isStaleOwnedTempArtifact(entry.name)) {
        throw new IdentityInvalidError("Remote storage contains a lock or symbolic link; stop all Harness instances and inspect it before migration.", "IDENTITY_LOCKED");
      }
      if (entry.name === LOCK_FILE_NAME || entry.name.includes(".refresh-lock") || entry.name.startsWith(`${LOCK_FILE_NAME}.takeover-`)) {
        throw new IdentityInvalidError("Remote storage contains a lock or symbolic link; stop all Harness instances and inspect it before migration.", "IDENTITY_LOCKED");
      }
      if (entry.isDirectory())
        await scan(entryPath);
    }
  };
  await scan(directory);
  const reclaimed = new Set;
  for (const takeoverPath of takeoverPaths) {
    if (reclaimed.has(takeoverPath))
      continue;
    if (!await takeOverLockOfExitedOwner(takeoverPath, 0, reclaimed)) {
      throw new IdentityInvalidError("Remote storage contains a lock or symbolic link; stop all Harness instances and inspect it before migration.", "IDENTITY_LOCKED");
    }
  }
  for (const lockPath of lockPaths) {
    if (!await takeOverLockOfExitedOwner(lockPath, 0, reclaimed)) {
      throw new IdentityInvalidError("Remote storage contains a lock or symbolic link; stop all Harness instances and inspect it before migration.", "IDENTITY_LOCKED");
    }
  }
}
var REFRESH_QUEUE_TEMP_PATTERN = /^(server-credentials\.json\.refresh-lock(?:\.holder-\d+-[0-9a-f-]{36})?)\.([1-9]\d*)\.[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
function isRefreshQueueTemp(name) {
  return REFRESH_QUEUE_TEMP_PATTERN.test(name);
}
async function isVerifiedRefreshHardlink(directory, name, names) {
  const temporary = REFRESH_QUEUE_TEMP_PATTERN.exec(name) === null ? names.filter((candidate) => REFRESH_QUEUE_TEMP_PATTERN.exec(candidate)?.[1] === name) : [name];
  if (temporary.length !== 1)
    return false;
  const match = REFRESH_QUEUE_TEMP_PATTERN.exec(temporary[0]);
  if (match === null || !names.includes(match[1]) || !ownerExited2(`${match[2]}
`))
    return false;
  const [source, published] = await Promise.all([
    lstat(join3(directory, temporary[0]), { bigint: true }),
    lstat(join3(directory, match[1]), { bigint: true })
  ]);
  return source.isFile() && published.isFile() && source.nlink === 2n && published.nlink === 2n && source.dev === published.dev && source.ino === published.ino;
}
function isRefreshQueueArtifact(name) {
  return /^server-credentials\.json\.refresh-lock\.holder-\d+-[0-9a-f-]{36}$/.test(name) || isRefreshQueueTemp(name);
}
function fingerprint(publicKey) {
  const compact = createHash2("sha256").update(fromBase64Url(publicKey)).digest("hex").slice(0, 12).toUpperCase();
  return compact.match(/.{1,4}/g).join(" ");
}
async function assertPrivateMode2(path) {
  if (process.platform === "win32")
    return;
  const mode = (await stat2(path)).mode & 511;
  if ((mode & 63) !== 0) {
    throw new IdentityInvalidError(`private key permissions must be 0600, got ${mode.toString(8).padStart(3, "0")}`);
  }
}
async function atomicJsonWrite(path, value, mode) {
  await atomicTextWrite(path, `${JSON.stringify(value, null, 2)}
`, mode);
}
async function atomicTextWrite(path, value, mode) {
  await mkdir2(dirname2(path), { recursive: true, mode: 448 });
  const temporary = `${path}.${process.pid}.${uuidV7()}.tmp`;
  await writeFile2(temporary, value, { encoding: "utf8", mode, flag: "wx" });
  await chmod2(temporary, mode);
  await rename2(temporary, path);
  await chmod2(path, mode);
}
async function exists2(path) {
  try {
    await stat2(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}
function safeErrorMessage(error) {
  return error instanceof Error ? error.message : "invalid identity data";
}
var LOCK_FILE_NAME = "device.lock";
var LOCK_TIMEOUT_MS = 15000;
var LOCK_RETRY_INITIAL_MS = 20;
var LOCK_RETRY_MAX_MS = 200;
async function withIdentityLock(directory, operation) {
  const lockPath = join3(directory, LOCK_FILE_NAME);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let delay = LOCK_RETRY_INITIAL_MS;
  for (;; ) {
    try {
      await writeFile2(lockPath, `${process.pid}
`, { encoding: "utf8", mode: 384, flag: "wx" });
      break;
    } catch (error) {
      if (!await isLockContention2(error, lockPath))
        throw error;
      if (await takeOverLockOfExitedOwner(lockPath))
        continue;
    }
    if (Date.now() >= deadline) {
      throw new IdentityInvalidError("device identity is locked by another process; stop other DSH instances and retry", "IDENTITY_LOCKED");
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
  }
  try {
    return await operation();
  } finally {
    await rm3(lockPath, { force: true });
  }
}
async function isLockContention2(error, lockPath) {
  if (!isNodeError(error))
    return false;
  if (error.code === "EEXIST")
    return true;
  if (error.code !== "EPERM" || process.platform !== "win32")
    return false;
  return exists2(lockPath);
}
var MAX_LOCK_TAKEOVER_DEPTH = 8;
async function takeOverLockOfExitedOwner(lockPath, depth = 0, reclaimed) {
  if (depth >= MAX_LOCK_TAKEOVER_DEPTH)
    return false;
  const record = await readLockRecord2(lockPath);
  if (record === undefined || !ownerExited2(record))
    return false;
  const lockName = basename2(lockPath);
  const claimInput = lockName === LOCK_FILE_NAME ? record : `${lockName}
${record}`;
  const claimPath = join3(dirname2(lockPath), `${LOCK_FILE_NAME}.takeover-${createHash2("sha256").update(claimInput).digest("hex").slice(0, 16)}`);
  if (claimPath === lockPath)
    return false;
  if (!await acquireTakeoverClaim(claimPath, depth, reclaimed))
    return false;
  try {
    if (await readLockRecord2(lockPath) !== record || !ownerExited2(record))
      return false;
    await rm3(lockPath, { force: true });
    reclaimed?.add(lockPath);
    return true;
  } finally {
    await rm3(claimPath, { force: true }).catch(() => {
      return;
    });
  }
}
async function acquireTakeoverClaim(claimPath, depth, reclaimed) {
  for (let attempt = 0;attempt < 2; attempt++) {
    try {
      await writeFile2(claimPath, `${process.pid}
`, { encoding: "utf8", mode: 384, flag: "wx" });
      return true;
    } catch (error) {
      if (!await isLockContention2(error, claimPath))
        throw error;
      if (attempt > 0 || !await takeOverLockOfExitedOwner(claimPath, depth + 1, reclaimed))
        return false;
    }
  }
  return false;
}
async function readLockRecord2(lockPath) {
  try {
    return await readFile2(lockPath, "utf8");
  } catch {
    return;
  }
}
function ownerExited2(record) {
  if (!/^\d+\n$/.test(record))
    return false;
  const pid = Number(record.trim());
  if (pid === 0 || pid > 2147483647)
    return false;
  if (pid === process.pid)
    return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return isNodeError(error) && error.code === "ESRCH";
  }
}
function isScopedClientDirectory(directory) {
  return /[\\/]servers[\\/][a-f0-9]{24}[\\/]client$/.test(directory);
}
async function hasVerifiedScopedIdentity(directory) {
  try {
    const serversPath = join3(directory, "servers");
    const metadata = await lstat(serversPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      return false;
    for (const scope of await readdir2(serversPath, { withFileTypes: true })) {
      if (!scope.isDirectory() || scope.isSymbolicLink() || !/^[a-f0-9]{24}$/.test(scope.name))
        continue;
      for (const role of await readdir2(join3(serversPath, scope.name), { withFileTypes: true })) {
        if (!role.isDirectory() || role.isSymbolicLink() || role.name !== "host" && role.name !== "client")
          continue;
        const roleDir = join3(serversPath, scope.name, role.name);
        try {
          for (const fileName of ["device.json", "device.key"]) {
            const fileStat = await lstat(join3(roleDir, fileName));
            if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1 || fileStat.size > 16 * 1024 * 1024) {
              throw new Error("invalid identity file metadata");
            }
          }
          await assertPrivateMode2(join3(roleDir, "device.key"));
          const record = identitySchema.parse(JSON.parse(await readFile2(join3(roleDir, "device.json"), "utf8")));
          const key = (await readFile2(join3(roleDir, "device.key"), "utf8")).trim();
          if (generateKeyPair(fromBase64Url(key)).publicKey === record.publicKey)
            return true;
        } catch {
          continue;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}
async function canAutoHealClientIdentity(directory, allowServersDirectory = false) {
  try {
    const entries = await readStorageEntries(directory);
    for (const entry of entries) {
      if (isLockArtifact(entry.name))
        continue;
      const entryPath = join3(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink())
        return false;
      if (allowServersDirectory && entry.name === "servers" && metadata.isDirectory())
        continue;
      if (!metadata.isFile())
        return false;
      if (entry.name === "device.json" || entry.name === "device.key" || isIdentityTempArtifact(entry.name) || isPeerTempArtifact(entry.name) || isBackupArtifact(entry.name)) {
        continue;
      }
      if (entry.name === "trusted-peers.json") {
        const parsed = trustedPeersSchema.parse(JSON.parse(await readFile2(entryPath, "utf8")));
        if (parsed.peers.length > 0)
          return false;
        continue;
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
async function ensureDirectory(directory) {
  await mkdir2(directory, { recursive: true, mode: 448 });
  await chmod2(directory, 448);
}
async function removeIdentityRecords(directory) {
  let entries;
  try {
    entries = await readdir2(directory);
  } catch {
    return;
  }
  await Promise.all(entries.filter((name) => isOwnedIdentityRecord(name)).map((name) => unlink(join3(directory, name)).catch(() => {
    return;
  })));
}
function isTakeoverLockArtifact(name) {
  return /^device\.lock\.takeover-[0-9a-f]{16}$/.test(name);
}
function isLockArtifact(name) {
  return name === LOCK_FILE_NAME || isTakeoverLockArtifact(name);
}
var STORAGE_METADATA_ARTIFACTS = new Set([".ds_store", "desktop.ini", "thumbs.db"]);
function isStorageMetadataArtifact(name) {
  return STORAGE_METADATA_ARTIFACTS.has(name.toLowerCase());
}
function isBackupArtifact(name) {
  return STORAGE_CONFLICT_ENTRY_PATTERN.test(name);
}
function safeStorageEntryName(name) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160);
  return safe === "" ? "unnamed" : safe;
}
async function readStorageEntries(directory) {
  const entries = await readdir2(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (isStorageMetadataArtifact(entry.name) && entry.isFile()) {
      const metadata = await lstat(join3(directory, entry.name));
      if (metadata.isFile() && metadata.nlink === 1 && metadata.size <= 16 * 1024 * 1024)
        continue;
    }
    result.push(entry);
  }
  return result;
}
async function isExitedLockArtifact(path) {
  const record = await readLockRecord2(path);
  return record !== undefined && ownerExited2(record);
}
function isPeerTempArtifact(name) {
  return /^trusted-peers\.json\.[1-9]\d*\.[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/.test(name);
}
var OWNED_TEMP_ARTIFACT_PATTERN = /^(?:device\.json|device\.key|trusted-peers\.json|server-credentials\.json|host-pairing\.json|pairing-host-only\.json)\.([1-9]\d*)\.[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
function isOwnedTempArtifact(name) {
  return OWNED_TEMP_ARTIFACT_PATTERN.test(name);
}
function isStaleOwnedTempArtifact(name) {
  const match = OWNED_TEMP_ARTIFACT_PATTERN.exec(name);
  if (match === null)
    return false;
  return ownerExited2(`${match[1]}
`);
}
function isIdentityTempArtifact(name) {
  return (name.startsWith("device.json.") || name.startsWith("device.key.")) && name.endsWith(".tmp");
}
function isOwnedIdentityRecord(name) {
  if (name === "device.json" || name === "device.key" || name === "trusted-peers.json" || name === "host-pairing.json")
    return true;
  return (name.startsWith("device.json.") || name.startsWith("device.key.") || name.startsWith("trusted-peers.json.") || name.startsWith("host-pairing.json.")) && name.endsWith(".tmp");
}
async function removeStaleTemporaries(directory) {
  let entries;
  try {
    entries = await readdir2(directory);
  } catch {
    return;
  }
  await Promise.all(entries.map(async (name) => {
    const entryPath = join3(directory, name);
    if (isIdentityTempArtifact(name) || isStaleOwnedTempArtifact(name)) {
      await unlink(entryPath).catch(() => {
        return;
      });
      return;
    }
    if (isTakeoverLockArtifact(name)) {
      await takeOverLockOfExitedOwner(entryPath).catch(() => {
        return;
      });
    }
  }));
}
// packages/plugin/src/logging.ts
var levels = ["debug", "info", "warn", "error"];
var secretKey = /authorization|cookie|token|secret|private|shared|ciphertext|payload|prompt|source|workspace|output|registrationCode|deviceCode/i;

class SafeLogger {
  sink;
  threshold;
  constructor(sink, threshold = "info") {
    this.sink = sink;
    this.threshold = threshold;
  }
  debug(message, fields) {
    this.write("debug", message, fields);
  }
  info(message, fields) {
    this.write("info", message, fields);
  }
  warn(message, fields) {
    this.write("warn", message, fields);
  }
  error(message, fields) {
    this.write("error", message, fields);
  }
  write(level, message, fields) {
    const threshold = typeof this.threshold === "function" ? this.threshold() : this.threshold;
    if (levels.indexOf(level) < levels.indexOf(threshold))
      return;
    const safeFields = fields === undefined ? "" : ` ${JSON.stringify(redact(fields))}`;
    this.sink[level](`[ds-harness-remote] ${message}${safeFields}`);
  }
}
function redact(value, key = "") {
  if (secretKey.test(key))
    return "[REDACTED]";
  if (Array.isArray(value))
    return value.map((item) => redact(item));
  if (typeof value !== "object" || value === null)
    return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
}
export {
  ConnectionController,
  HostPairing,
  HostServerApi,
  HostServerConnection,
  IdentityStore,
  MAX_SECURE_MESSAGE_BYTES,
  SafeLogger,
  ServerCredentialStore,
  createEvent,
  createRpcError,
  createRpcResponse
};
