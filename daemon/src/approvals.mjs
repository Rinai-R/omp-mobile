/** Request/answer compatibility for the six OMP RPC dialogs. No authorization policy lives here. */
import {
  validateForm,
  validateAsk,
} from "../vendor/omp-form/rpc-validation.mjs";
export function approvalAnswer(message) {
  const answer = {};
  if (typeof message.value === "string") answer.value = message.value;
  if (typeof message.confirmed === "boolean")
    answer.confirmed = message.confirmed;
  if (message.cancelled === true) answer.cancelled = true;
  if (
    message.data !== null &&
    typeof message.data === "object" &&
    !Array.isArray(message.data)
  )
    answer.data = message.data;
  if (Array.isArray(message.answers)) answer.answers = message.answers;
  return answer;
}
export function validateApproval(request, answer) {
  if (answer.cancelled === true) return;
  if (request.method === "form") {
    if (typeof request.html !== "string") throw new Error("Form has no HTML");
    validateForm(request.html, answer);
  } else if (request.method === "ask")
    validateAsk(request.questions ?? [], answer);
  else if (request.method === "select") {
    if (
      typeof answer.value !== "string" ||
      !request.options?.includes(answer.value)
    )
      throw new Error("Select one of the offered options");
  } else if (request.method === "confirm") {
    if (typeof answer.confirmed !== "boolean")
      throw new Error("Confirm needs a boolean answer");
  } else if (request.method === "input" || request.method === "editor") {
    if (typeof answer.value !== "string")
      throw new Error("Input needs a text answer");
  } else throw new Error(`Unsupported approval method: ${request.method}`);
}
