import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { SUBAGENTS_FEATURE, knownFeatures, listSubagents } from "../api";
import { t } from "../i18n/index.ts";
import { callSubagents } from "../subagents";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import type { Machine, Subagent, ToolItem } from "../types";
import { Spinner } from "./brand";
import { ChevronGlyph } from "./icons";

const LIST_POLL_MS = 3_000;

/**
 * A chat's subagents, for the rows that started or waited on them: the list
 * (null until fetched), the level a transcript shows (null: the session's
 * own), and how one opens.
 */
export interface SubagentLinksValue {
  list: Subagent[] | null;
  parent: string | null;
  open: (subagent: Subagent) => void;
}

export const SubagentLinksContext = createContext<SubagentLinksValue | null>(null);

/**
 * The session's subagents, fetched once something delegated (`hasAgentCalls`)
 * and polled while a delegation runs or a subagent still does. Null on a
 * daemon without `subagents`.
 */
export function useSessionSubagents(machine: Machine, sessionId: string, hasAgentCalls: boolean, agentRunning: boolean, features: readonly string[]): Subagent[] | null {
  const supported = features.includes(SUBAGENTS_FEATURE) || knownFeatures(machine).includes(SUBAGENTS_FEATURE);
  const [list, setList] = useState<Subagent[] | null>(null);
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const anyRunning = list?.some((subagent) => subagent.status === "running") === true;
  const poll = agentRunning || anyRunning;
  // A delegation that just finished: one more look, so its rows show the final status.
  const [settle, setSettle] = useState(0);
  const wasRunning = useRef(agentRunning);
  useEffect(() => {
    if (wasRunning.current && !agentRunning) setSettle((value) => value + 1);
    wasRunning.current = agentRunning;
  }, [agentRunning]);
  useEffect(() => {
    if (!supported || !hasAgentCalls) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      listSubagents(machineRef.current, sessionId)
        .then((next) => {
          if (!cancelled) setList(next);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled && poll) timer = setTimeout(load, LIST_POLL_MS);
        });
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasAgentCalls, poll, sessionId, settle, supported]);
  return supported ? list : null;
}

/** Under a `task` or `wait` row: the subagents it is about, one tap from each one's transcript. */
export function SubagentLinks({ tool }: { tool: ToolItem }): ReactNode {
  const links = useContext(SubagentLinksContext);
  const styles = useStyles(createStyles);
  const colors = useColors();
  const mine = useMemo(() => (links?.list == null ? [] : callSubagents(links.list, links.parent, tool)), [links, tool]);
  if (links === null || mine.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {mine.map((subagent) => {
        const running = subagent.status === "running";
        const tone = statusTone(subagent.status, colors);
        return (
          <Pressable
            key={subagent.id}
            onPress={() => links.open(subagent)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t("subagents.openA11y", { name: subagent.agentId, status: t(`subagents.status.${subagent.status}`) })}
          >
            <View style={styles.lead}>{running ? <Spinner size={10} color={colors.accentB} /> : <View style={[styles.dot, { backgroundColor: tone }]} />}</View>
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>
                {subagent.agentId}
              </Text>
              {subagent.description ?? subagent.task ? (
                <Text style={styles.task} numberOfLines={1}>
                  {(subagent.description ?? subagent.task ?? "").replace(/^#[^\n]*\n+/gm, "").replace(/\s+/g, " ").trim()}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.status, { color: tone }]}>{t(`subagents.status.${subagent.status}`)}</Text>
            <ChevronGlyph size={14} color={colors.fgFaint} />
          </Pressable>
        );
      })}
    </View>
  );
}

function statusTone(status: Subagent["status"], c: Palette): string {
  return status === "running" ? c.accentB : status === "completed" ? c.ok : status === "failed" ? c.err : c.fgFaint;
}

function createStyles(c: Palette) {
  return {
    wrap: { marginLeft: 46, marginRight: 10, marginBottom: 8, gap: 4 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.md,
      backgroundColor: c.well,
      borderWidth: 0.5,
      borderColor: c.border,
    },
    pressed: { opacity: 0.7 },
    lead: { width: 12, alignItems: "center" },
    dot: { width: 7, height: 7, borderRadius: 4 },
    text: { flex: 1, minWidth: 0 },
    name: { fontFamily: SANS, fontSize: 14, lineHeight: 19, fontWeight: "600", color: c.fg },
    task: { fontFamily: SANS, fontSize: 12.5, lineHeight: 17, color: c.fgMuted },
    status: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16 },
  } as const;
}
