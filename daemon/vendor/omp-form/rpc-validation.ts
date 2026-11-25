// @ts-nocheck
// MIT: adapted from oh-my-pi rpc-mode.ts blob 1caea73d10ce1d29747e2cc4f86eadcd86800379.
// Kept on the computer so HTML pattern validation uses the same RegExp v semantics as OMP.
import {choiceValue,defaultFormData,fieldError,isArrayChoice,textValue} from './data.mjs';
import {parseHtmlForm} from './parse.mjs';
const isRecord=(value:unknown)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function parseAskDialogResponse(
	response: RpcExtensionUIResponse,
	questions: ExtensionAskDialogQuestion[],
	dialogOptions: ExtensionUIDialogOptions,
): ExtensionAskDialogSubmitResult | undefined {
	if ("cancelled" in response && response.cancelled) {
		if (response.timedOut) dialogOptions.onTimeout?.();
		return undefined;
	}
	const answers: unknown = "answers" in response ? response.answers : undefined;
	if (!Array.isArray(answers) || answers.length !== questions.length) {
		throw new Error(`Ask dialog response must carry ${questions.length} answers in question order`);
	}
	return {
		kind: "submit",
		results: questions.map((question, index) => {
			const answer: unknown = answers[index];
			if (!isRecord(answer) || answer.id !== question.id) {
				throw new Error(`Ask dialog answer ${index} must have id ${JSON.stringify(question.id)}`);
			}
			const labels = question.options.map(option => option.label);
			const multi = question.multi ?? false;
			const { selectedOptions, customInput } = answer;
			if (!Array.isArray(selectedOptions)) {
				throw new Error(`Ask dialog answer ${JSON.stringify(question.id)} must carry a selectedOptions array`);
			}
			const selected: string[] = [];
			for (const label of selectedOptions) {
				if (typeof label !== "string" || !labels.includes(label)) {
					throw new Error(
						`Ask dialog answer ${JSON.stringify(question.id)} selected unknown option ${JSON.stringify(label)}`,
					);
				}
				if (selected.includes(label)) {
					throw new Error(
						`Ask dialog answer ${JSON.stringify(question.id)} selected ${JSON.stringify(label)} twice`,
					);
				}
				selected.push(label);
			}
			if (customInput !== undefined && typeof customInput !== "string") {
				throw new Error(`Ask dialog answer ${JSON.stringify(question.id)} customInput must be a string`);
			}
			const custom = customInput?.trim() || undefined;
			if (!multi && (selected.length > 1 || (selected.length > 0 && custom !== undefined))) {
				throw new Error(
					`Ask dialog answer ${JSON.stringify(question.id)} is single-select but carries more than one answer`,
				);
			}
			return {
				id: question.id,
				question: question.question,
				options: labels,
				multi,
				selectedOptions: selected,
				customInput: custom,
			};
		}),
	};
}

function parseFormChoice(field: ChoiceField, value: unknown): HtmlFormValue | undefined {
	const label = JSON.stringify(field.name);
	// An omitted field means nothing checked: an empty array for array choices, as `choiceValue` gives everywhere else.
	if (value === undefined) return choiceValue(field, new Set());
	const array = isArrayChoice(field);
	const shape = array ? "an array of strings" : "one string, not an array";
	if (array !== Array.isArray(value)) throw new Error(`Form field ${label} must carry ${shape}`);
	const entries: unknown[] = array ? (value as unknown[]) : [value];

	// Map each entry to an option index, keeping at most one unmatched entry as the "Other" text.
	const checked = new Set<number>();
	let other: string | undefined;
	for (const entry of entries) {
		if (typeof entry !== "string") throw new Error(`Form field ${label} must carry ${shape}`);
		// Prefer an enabled option, so a disabled duplicate of the same value earlier in the group cannot shadow it.
		const enabled = field.options.findIndex(option => !option.disabled && option.value === entry);
		const index = enabled >= 0 ? enabled : field.options.findIndex(option => option.value === entry);
		if (index >= 0 && field.options[index]!.disabled) {
			throw new Error(`Form field ${label} carries disabled option ${JSON.stringify(entry)}`);
		}
		if (index >= 0 && !checked.has(index)) {
			checked.add(index);
		} else if (index < 0 && field.other && other === undefined) {
			other = entry;
		} else {
			throw new Error(`Form field ${label} carries unexpected value ${JSON.stringify(entry)}`);
		}
	}
	return choiceValue(field, checked, other);
}

/**
 * Keeps valid selections, treating an echoed same-name hidden value as no selection when it cannot be the answer.
 * A host submitting like a browser sends the hidden value inside an array choice's entries too: there it is dropped
 * up front when no option carries it (it would otherwise pose as the "Other" text), else only when keeping it fails.
 */
function parseChoiceOrHiddenFallback(
	field: ChoiceField,
	value: unknown,
	hiddenValue: string | undefined,
): HtmlFormValue | undefined {
	if (hiddenValue === undefined) return parseFormChoice(field, value);
	const echo = Array.isArray(value) ? value.indexOf(hiddenValue) : value === hiddenValue ? 0 : -1;
	if (echo < 0) return parseFormChoice(field, value);
	const withoutEcho = Array.isArray(value) ? value.toSpliced(echo, 1) : undefined;
	if (Array.isArray(value) && !field.options.some(option => option.value === hiddenValue)) {
		return parseFormChoice(field, withoutEcho);
	}
	try {
		return parseFormChoice(field, value);
	} catch {
		return parseFormChoice(field, withoutEcho);
	}
}

/** Value a text field's submitted entry gives: a string, or a number for `number`/`range` inputs; absent counts as empty. */
function parseFormText(field: TextField, value: unknown): HtmlFormValue {
	if (value === undefined) return textValue(field, "");
	const numeric = field.type === "number" || field.type === "range";
	if (typeof value === "string" || (numeric && typeof value === "number" && Number.isFinite(value))) {
		return textValue(field, String(value));
	}
	throw new Error(`Form field ${JSON.stringify(field.name)} must carry a string${numeric ? " or a number" : ""}`);
}

/** Validates submitted `form` data against the parsed form; any mismatch throws instead of guessing. */
function parseFormDialogResponse(
	response: RpcExtensionUIResponse,
	form: HtmlForm,
	dialogOptions: ExtensionUIDialogOptions,
): ExtensionFormDialogResult | undefined {
	if ("cancelled" in response && response.cancelled) {
		if (response.timedOut) dialogOptions.onTimeout?.();
		return undefined;
	}
	const submitted: unknown = "data" in response ? response.data : undefined;
	if (!isRecord(submitted)) throw new Error("Form dialog response must carry a data object");

	// Reject names the form does not have; hidden inputs may be echoed but keep the form's own values.
	const named = form.fields.filter(field => field.name);
	const names = new Set([...named.map(field => field.name), ...form.hidden.map(([name]) => name)]);
	for (const name of Object.keys(submitted)) {
		if (!names.has(name)) throw new Error(`Form dialog data carries unknown field ${JSON.stringify(name)}`);
	}

	// One entry answers every field of its name, as in HTML form data. Each field that can carry the entry takes it;
	// a same-name field of another shape (a radio group beside a checkbox group, a group without "Other" beside a
	// text input) counts as unanswered, as it would in the TUI where the last field wins. At least one field must
	// carry the entry, and every field must pass the rules the form dialogs apply on submit.
	// A null prototype keeps a control named `__proto__` an ordinary key instead of hitting the inherited setter.
	const data: HtmlFormData = Object.assign(Object.create(null), Object.fromEntries(form.hidden));
	const hidden = new Map(form.hidden);
	const byName = Map.groupBy(named, field => field.name!);
	for (const [name, fields] of byName) {
		const entry = Object.hasOwn(submitted, name) ? submitted[name] : undefined;
		const hiddenValue = hidden.get(name);
		let mismatch: unknown;
		const values = fields.map(field => {
			try {
				const value =
					field.kind === "choice"
						? parseChoiceOrHiddenFallback(field, entry, hiddenValue)
						: parseFormText(field, entry);
				return { field, value, carried: true };
			} catch (error) {
				// Only a field sharing its name may decline the entry; a lone field's mismatch fails the answer.
				if (fields.length === 1) throw error;
				mismatch ??= error;
				const value = field.kind === "choice" ? parseFormChoice(field, undefined) : parseFormText(field, undefined);
				return { field, value, carried: false };
			}
		});
		if (!values.some(({ carried }) => carried)) throw mismatch;
		for (const { field, value, carried } of values) {
			const problem = fieldError(field, value);
			if (problem) throw new Error(`Form field ${JSON.stringify(name)}: ${problem}`);
			if (carried && value !== undefined) data[name] = value;
		}
	}
	return { data };
}


export function validateForm(html:string, answer:unknown){return parseFormDialogResponse(answer,parseHtmlForm(html),{});}
export function validateAsk(questions:unknown[],answer:unknown){return parseAskDialogResponse(answer,questions,{});}
