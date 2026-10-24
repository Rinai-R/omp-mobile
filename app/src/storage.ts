import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Machine } from "./types";

const MACHINES_KEY = "omp.machines.v1";
const SETTINGS_KEY = "omp.settings.v1";

export interface Settings {
  /** Background notifications (Android): the user turned them on and the system allowed it at the time. */
  notifications: boolean;
  /** The computer whose sessions the app opened on last: it opens there again. */
  lastMachineId?: string;
}

/** Off until the user turns them on: that is when Android asks for the notification permission. */
export const DEFAULT_SETTINGS: Settings = { notifications: false };

export async function loadMachines(): Promise<Machine[]> {
  try {
    const raw = await AsyncStorage.getItem(MACHINES_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Machine => {
      if (item === null || typeof item !== "object") return false;
      const machine = item as Partial<Machine>;
      return typeof machine.url === "string" && typeof machine.token === "string";
    });
  } catch {
    return [];
  }
}

export async function saveMachines(machines: Machine[]): Promise<void> {
  await AsyncStorage.setItem(MACHINES_KEY, JSON.stringify(machines));
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
