import { spansText } from "./parse.mjs";
/** Label of the free-text answer the UI adds to radio and checkbox groups ({@link ChoiceField.other}). */
export const OTHER_LABEL = "Other";
/** Whether a choice field reports an array (checkbox group, multi-select) rather than one value. */
export function isArrayChoice(field) {
    return field.multi && field.options.length > 1;
}
/**
 * Value a choice field contributes given its checked option indices and, when
 * the user chose its "Other" answer, that answer's text: the typed text stands
 * in for a radio's value, or joins a checkbox group's array. Undefined when the
 * field contributes nothing; blank Other text counts as no answer.
 */
export function choiceValue(field, checked, other) {
    const typed = field.other ? other?.trim() : undefined;
    const values = field.options.flatMap((option, index) => checked.has(index) && !option.disabled ? [option.value] : []);
    if (isArrayChoice(field))
        return typed ? [...values, typed] : values;
    return typed || values[0];
}
/** Value a text field contributes: a number for non-empty numeric `number`/`range` inputs, else the text. */
export function textValue(field, text) {
    if ((field.type === "number" || field.type === "range") && text.trim() !== "") {
        const number = Number(text);
        if (Number.isFinite(number))
            return number;
    }
    return text;
}
/**
 * Why `value` is not an acceptable answer for `field`, or undefined when it is.
 * Enforces `required`, numeric `min`/`max`, `minlength`/`maxlength`, `email`
 * and `url` shapes, and `pattern` (anchored, as HTML does; an invalid pattern
 * is ignored).
 */
export function fieldError(field, value) {
    if (field.kind === "choice") {
        const empty = value === undefined || (Array.isArray(value) && value.length === 0);
        if (!field.required || !empty)
            return undefined;
        return isArrayChoice(field) ? "Select at least one" : "Required";
    }
    const text = value === undefined ? "" : String(value);
    if (text.trim() === "")
        return field.required ? "Required" : undefined;
    if (field.type === "number" || field.type === "range") {
        const number = Number(text);
        if (!Number.isFinite(number))
            return "Enter a number";
        if (field.min !== undefined && number < field.min)
            return `Must be at least ${field.min}`;
        if (field.max !== undefined && number > field.max)
            return `Must be at most ${field.max}`;
    }
    if (field.minLength !== undefined && text.length < field.minLength)
        return `Needs at least ${field.minLength} characters`;
    if (field.maxLength !== undefined && text.length > field.maxLength)
        return `At most ${field.maxLength} characters`;
    if (field.type === "email" && !/^[^\s@]+@[^\s@]+$/.test(text))
        return "Enter an email address";
    if (field.type === "url" && !URL.canParse(text))
        return "Enter a full URL";
    if (field.pattern && compilePattern(field.pattern)?.test(text) === false) {
        return `Must match ${field.pattern.length > 40 ? `${field.pattern.slice(0, 39)}…` : field.pattern}`;
    }
    return undefined;
}
/** `^(?:pattern)$` as HTML matches `pattern`, or undefined when the model wrote an invalid one. */
function compilePattern(pattern) {
    try {
        return new RegExp(`^(?:${pattern})$`, "v");
    }
    catch {
        return undefined;
    }
}
/** Data the form submits untouched: hidden inputs, preselected options and prefilled text. */
export function defaultFormData(form) {
    // A null prototype keeps a control named `__proto__` an ordinary key instead of hitting the inherited setter.
    const data = Object.create(null);
    for (const [name, value] of form.hidden)
        data[name] = value;
    for (const field of form.fields) {
        if (!field.name)
            continue;
        const value = field.kind === "text"
            ? textValue(field, field.value)
            : choiceValue(field, new Set(field.options.flatMap((option, index) => (option.checked ? [index] : []))));
        if (value !== undefined)
            data[field.name] = value;
    }
    return data;
}
/**
 * The question each field answers: its own label, else the text block right
 * before it (`<p>Which database?</p>` above a radio group), else its section
 * title, else a lone option's label (a single checkbox), else its name.
 */
export function fieldQuestions(form) {
    const questions = new Map();
    for (const section of form.sections) {
        const title = spansText(section.title);
        let caption = "";
        for (const block of section.blocks) {
            if (block.kind === "field") {
                const field = block.field;
                const own = spansText(field.label);
                const lone = field.kind === "choice" && field.options.length === 1 ? spansText(field.options[0].label) : "";
                questions.set(field, oneLine(own || caption || title || lone || field.name));
                caption = "";
                continue;
            }
            caption = block.kind === "text" ? spansText(block.spans) : "";
        }
    }
    return questions;
}
/**
 * Plain text of a context block (paragraph or heading, list, preformatted
 * text, table) for hosts that cannot draw the form; undefined for fields and
 * pictures.
 */
export function blockText(block) {
    switch (block.kind) {
        case "text":
            return spansText(block.spans);
        case "pre":
            return block.text;
        case "list":
            return block.items
                .map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${spansText(item)}`)
                .join("\n");
        case "table":
            return block.rows.map(cells => cells.map(cell => spansText(cell)).join(" | ")).join("\n");
        default:
            return undefined;
    }
}
/**
 * The form's section titles and context blocks as plain text, in order, for a
 * host that shows the whole form with each named field titled by its question
 * ({@link fieldQuestions}): text that already is such a question is left out,
 * so it shows once. Blank parts are dropped.
 */
export function formContext(form) {
    const questions = new Set();
    for (const [field, question] of fieldQuestions(form))
        if (field.name)
            questions.add(question);
    const parts = [];
    for (const section of form.sections) {
        for (const text of [spansText(section.title).trim(), ...section.blocks.map(blockText)]) {
            if (text?.trim() && !questions.has(oneLine(text)))
                parts.push(text);
        }
    }
    return parts;
}
/**
 * The form text each named field's prompt carries when a host asks the form
 * one field at a time: section titles and context blocks since the previous
 * named field, text between the field's own options (unless another named
 * field sits among them), and, for the last field, the text after it. Text
 * that already is the field's question ({@link fieldQuestions}) is left out.
 * Parts are separated by blank lines; a field without context maps to `""`.
 */
export function fieldContexts(form) {
    const questions = fieldQuestions(form);
    const parts = new Map();
    let pending = [];
    let last;
    for (const section of form.sections) {
        const title = spansText(section.title).trim();
        if (title)
            pending.push(title);
        // A radio/checkbox group with text between its options keeps that text until `ownerEnd`, unless a named
        // field sits among those options: the text then stays with the field it precedes.
        let owner;
        let ownerEnd = 0;
        for (const [index, block] of section.blocks.entries()) {
            if (block.kind === "field") {
                if (!block.field.name)
                    continue;
                const question = questions.get(block.field);
                const own = pending.filter(part => oneLine(part) !== question);
                parts.set(block.field, own);
                pending = [];
                last = own;
                owner = own;
                const end = block.optionsEnd ?? 0;
                const intervening = section.blocks.some((later, at) => at > index && at < end && later.kind === "field" && later.field.name);
                ownerEnd = intervening ? 0 : end;
                continue;
            }
            const text = blockText(block);
            if (!text?.trim())
                continue;
            if (owner && index < ownerEnd)
                owner.push(text);
            else
                pending.push(text);
        }
    }
    last?.push(...pending);
    const contexts = new Map();
    for (const [field, own] of parts)
        contexts.set(field, own.join("\n\n"));
    return contexts;
}
/** Answers of every named field, in form order, with option values shown as their labels. */
export function formAnswers(form, data) {
    const questions = fieldQuestions(form);
    const answers = [];
    for (const field of form.fields) {
        if (!field.name)
            continue;
        const value = data[field.name];
        answers.push({
            name: field.name,
            question: questions.get(field) ?? field.name,
            answer: answerText(field, value),
        });
    }
    return answers;
}
function answerText(field, value) {
    if (value === undefined)
        return "";
    if (field.kind === "text")
        return String(value);
    const labelOf = (raw) => {
        const option = field.options.find(candidate => candidate.value === raw);
        if (option)
            return oneLine(spansText(option.label)) || raw;
        return field.other ? `${OTHER_LABEL}: ${raw}` : raw;
    };
    return Array.isArray(value) ? value.map(labelOf).join(", ") : labelOf(String(value));
}
function oneLine(text) {
    return text.replace(/\s+/g, " ").trim();
}
