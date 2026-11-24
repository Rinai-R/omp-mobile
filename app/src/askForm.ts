import { parseHtmlForm, spansText } from "../vendor/omp-form/parse.ts";

/** Read the single-choice forms the mobile approval sheet can answer directly. */
export function singleChoiceForm(html: string | undefined) {
  if (html === undefined) return undefined;
  try {
    const form = parseHtmlForm(html);
    const [field] = form.fields;
    if (form.fields.length !== 1 || field?.kind !== "choice" || field.multi || field.options.length === 0) return undefined;

    const section = form.sections.find((section) =>
      section.blocks.some((block) => block.kind === "field" && block.field.name === field.name),
    );
    const prose = section?.blocks.find((block) => block.kind === "text");
    const prompt = prose === undefined ? undefined : spansText(prose.spans);
    const question = spansText(section?.title ?? []) || prompt || "";
    return {
      name: field.name,
      question,
      prompt: prompt === question ? undefined : prompt,
      choices: field.options.map((option) => ({ value: option.value, label: spansText(option.label) })),
    };
  } catch {
    return undefined;
  }
}
