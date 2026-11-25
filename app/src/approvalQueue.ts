import type { ApprovalRequest } from "./types";
export function queueApproval(
  queue: ApprovalRequest[],
  request: ApprovalRequest,
): ApprovalRequest[] {
  if (
    !request ||
    typeof request.id !== "string" ||
    typeof request.method !== "string"
  )
    return queue;
  const index = queue.findIndex((r) => r.id === request.id);
  return index < 0
    ? [...queue, request]
    : queue.map((r, i) => (i === index ? request : r));
}
export function resolveApproval(
  queue: ApprovalRequest[],
  id: string,
): ApprovalRequest[] {
  return queue.filter((r) => r.id !== id);
}
