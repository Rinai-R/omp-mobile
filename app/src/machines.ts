import type { Machine } from "./types";

/** "RinaideMacBook-Pro.local" → "RinaideMacBook-Pro": the mDNS suffix says nothing in a list. */
export function shortName(name: string): string {
  return name.replace(/\.(local|lan|home)$/i, "");
}

/** What the app calls a computer: the name the user gave it on this phone, else its host name. */
export function displayName(machine: Pick<Machine, "name" | "label">): string {
  const label = machine.label?.trim();
  return label !== undefined && label !== "" ? label : shortName(machine.name);
}

/** The host part of a machine's address: `100.68.127.23`, `box.tail1234.ts.net`. */
export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
}

/** A machine's name among `machines`: with its address when another one is called the same. */
export function machineLabel(machine: Machine, machines: readonly Machine[]): string {
  const name = displayName(machine);
  const twins = machines.filter((item) => displayName(item) === name);
  return twins.length < 2 ? name : `${name} · ${hostOf(machine.url)}`;
}

/** The longest name the rename field keeps. */
export const MAX_LABEL = 40;

/** A typed name made storable: trimmed, one line, bounded; empty means "use the host name". */
export function cleanLabel(text: string): string | undefined {
  const label = text.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
  return label === "" ? undefined : label;
}
