import {
  parseHtmlForm,
  type HtmlForm,
  type ChoiceField,
} from "../vendor/omp-form/parse.ts";
import {
  defaultFormData,
  fieldError,
  choiceValue,
  textValue,
  type HtmlFormData,
} from "../vendor/omp-form/data.ts";
import type { ApprovalAnswer, ApprovalRequest } from "./types";

/** The same field model as OMP; ask has a distinct wire format, adapted only at its boundary. */
export function approvalForm(request: ApprovalRequest): HtmlForm | undefined {
  if (request.method === "form") {
    if (
      typeof request.html !== "string" ||
      request.html.length > 2 * 1024 * 1024
    )
      throw new Error("Invalid or oversized form");
    const form = parseHtmlForm(request.html);
    if (form.fields.length > 256) throw new Error("Too many form fields");
    return form;
  }
  if (request.method !== "ask") return undefined;
  if (!Array.isArray(request.questions) || !request.questions.length)
    throw new Error("Ask has no questions");
  const fields: ChoiceField[] = request.questions.map((q) => ({
    kind: "choice",
    name: q.id,
    multi: q.multi === true,
    select: false,
    other: true,
    label: [{ text: q.question }],
    required: false,
    options: q.options.map((o, index) => ({
      value: o.label,
      label: [
        { text: o.label },
        ...(o.description ? [{ text: `\n${o.description}` }] : []),
        ...(o.preview
          ? [{ text: `\n${o.preview}`, style: "code" as const }]
          : []),
      ],
      checked: index === q.recommended,
      disabled: false,
    })),
  }));
  return {
    fields,
    hidden: [],
    sections: fields.map((field, i) => ({
      title: request.questions?.[i]?.header
        ? [{ text: request.questions[i]!.header! }]
        : [],
      fieldset: true,
      blocks: [{ kind: "field", field }],
    })),
  };
}

export interface ApprovalDraft {
  values: HtmlFormData;
  checked: Record<string, number[]>;
  others: Record<string, string>;
  usingOther: Record<string, boolean>;
  text: string;
}
export function initialApprovalDraft(
  request: ApprovalRequest,
  form?: HtmlForm,
): ApprovalDraft {
  const checked: Record<string, number[]> = Object.create(null);
  for (const f of form?.fields ?? [])
    if (f.kind === "choice")
      checked[f.name] = f.options.flatMap((o, i) =>
        o.checked && !o.disabled ? [i] : [],
      );
  return {
    values: form ? defaultFormData(form) : {},
    checked,
    others: Object.create(null),
    usingOther: Object.create(null),
    text: request.prefill ?? "",
  };
}
export function setChoice(
  draft: ApprovalDraft,
  field: ChoiceField,
  index: number,
): ApprovalDraft {
  if (field.options[index]?.disabled) return draft;
  const checked = new Set(draft.checked[field.name] ?? []);
  if (!field.multi) checked.clear();
  if (checked.has(index)) checked.delete(index);
  else checked.add(index);
  return {
    ...draft,
    checked: { ...draft.checked, [field.name]: [...checked] },
    usingOther: {
      ...draft.usingOther,
      [field.name]: field.multi && draft.usingOther[field.name] === true,
    },
  };
}
export function formData(form: HtmlForm, draft: ApprovalDraft): HtmlFormData {
  const data: HtmlFormData = Object.assign(
    Object.create(null),
    Object.fromEntries(form.hidden),
  );
  for (const f of form.fields) {
    if (!f.name) continue;
    const value =
      f.kind === "choice"
        ? choiceValue(
            f,
            new Set(draft.checked[f.name] ?? []),
            draft.usingOther[f.name] === true &&
              typeof draft.others[f.name] === "string"
              ? draft.others[f.name]
              : undefined,
          )
        : textValue(f, String(draft.values[f.name] ?? ""));
    if (value !== undefined) data[f.name] = value;
  }
  return data;
}
export function approvalErrors(
  form: HtmlForm,
  draft: ApprovalDraft,
): Record<string, string> {
  const data = formData(form, draft);
  return Object.fromEntries(
    form.fields.flatMap((f) => {
      const error = fieldError(f, data[f.name]);
      return error ? [[f.name, error]] : [];
    }),
  );
}
export function approvalResponse(
  request: ApprovalRequest,
  form: HtmlForm | undefined,
  draft: ApprovalDraft,
): ApprovalAnswer {
  if (request.method === "ask")
    return {
      answers: (request.questions ?? []).map((q) => ({
        id: q.id,
        selectedOptions: (draft.checked[q.id] ?? []).flatMap((i) =>
          q.options[i] ? [q.options[i]!.label] : [],
        ),
        ...(draft.usingOther[q.id] === true &&
        typeof draft.others[q.id] === "string" &&
        draft.others[q.id]?.trim()
          ? { customInput: draft.others[q.id]!.trim() }
          : {}),
      })),
    };
  if (!form) return { value: draft.text };
  return { data: formData(form, draft) };
}
/** Identity includes content, so a reused request ID never loads answers to another question. */
export function approvalIdentity(request: ApprovalRequest): string {
  const { receivedAt: _at, expiresAt: _expires, ...content } = request;
  return JSON.stringify(content);
}
export function hasSensitiveFields(
  request: ApprovalRequest,
  form?: HtmlForm,
): boolean {
  return (
    request.secret === true ||
    form?.fields.some((f) => f.kind === "text" && f.type === "password") ===
      true
  );
}
