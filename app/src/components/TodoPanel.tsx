import { useCallback, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type PressableStateCallbackType } from "react-native";
import { todoProgress, type TodoPhase, type TodoTask } from "../todos";
import { SANS, MONO, radius, useStyles, type Palette } from "../theme";
import { Disclosure } from "./ui";

/** The mark a task carries: done, running, waiting, blocked, dropped. */
function TaskMark({ status }: { status: TodoTask["status"] }): ReactNode {
  const styles = useStyles(createStyles);
  if (status === "completed") {
    return (
      <Text style={styles.markDone} accessibilityLabel="done">
        ✓
      </Text>
    );
  }
  if (status === "in_progress") return <View style={styles.markActive} accessibilityLabel="in progress" />;
  if (status === "blocked") {
    return (
      <Text style={styles.markBlocked} accessibilityLabel="blocked">
        !
      </Text>
    );
  }
  if (status === "abandoned") {
    return (
      <Text style={styles.markAbandoned} accessibilityLabel="abandoned">
        ×
      </Text>
    );
  }
  return <View style={styles.markPending} accessibilityLabel="pending" />;
}

/**
 * OMP's todo list above the composer: collapsed to the count and the current
 * task, opened to every phase. Nothing renders when the session has no todos.
 */
export function TodoPanel({ phases }: { phases: readonly TodoPhase[] }): ReactNode {
  const styles = useStyles(createStyles);
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const head = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.head, pressed && styles.pressed],
    [styles],
  );
  const { done, total, current } = todoProgress(phases);
  if (total === 0) return null;
  return (
    <View style={styles.panel}>
      <Pressable
        onPress={toggle}
        style={head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Todos, ${done} of ${total} done`}
      >
        <Text style={styles.title}>todos</Text>
        <Text style={styles.count}>
          {done}/{total}
        </Text>
        {current !== undefined && !open ? (
          <Text style={styles.current} numberOfLines={1}>
            {current}
          </Text>
        ) : (
          <View style={styles.spacer} />
        )}
        <Disclosure open={open} size={12} />
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {phases.map((phase, phaseIndex) => (
            <View key={`${phase.name}-${phaseIndex}`} style={styles.phase}>
              <Text style={styles.phaseName}>{phase.name}</Text>
              {phase.tasks.map((task, index) => (
                <View key={`${task.content}-${index}`} style={styles.task}>
                  <View style={styles.markSlot}>
                    <TaskMark status={task.status} />
                  </View>
                  <Text
                    style={
                      task.status === "completed"
                        ? styles.taskDone
                        : task.status === "in_progress"
                          ? styles.taskActive
                          : task.status === "blocked"
                            ? styles.taskBlocked
                            : styles.task
                    }
                  >
                    {task.content}
                    {task.blocker !== undefined ? <Text style={styles.blocker}> — {task.blocker}</Text> : null}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(c: Palette) {
  return {
    panel: {
      marginHorizontal: 12,
      marginBottom: 6,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.raised,
      overflow: "hidden",
    },
    head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 34, paddingHorizontal: 10, paddingVertical: 6 },
    pressed: { backgroundColor: c.hover },
    title: {
      fontFamily: MONO,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      color: c.fgFaint,
    },
    count: { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.accent },
    current: { flex: 1, fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgMuted },
    spacer: { flex: 1 },
    body: {
      gap: 6,
      paddingHorizontal: 10,
      paddingTop: 6,
      paddingBottom: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    phase: { gap: 4 },
    phaseName: {
      fontFamily: MONO,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: c.fgFaint,
    },
    task: { flexDirection: "row", gap: 7, alignItems: "flex-start" },
    markSlot: { width: 12, alignItems: "center", justifyContent: "center", minHeight: 17 },
    markDone: { fontFamily: SANS, fontSize: 11, lineHeight: 15, color: c.ok },
    markActive: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent },
    markPending: {
      width: 5,
      height: 5,
      borderRadius: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.fgFaint,
    },
    markBlocked: { fontFamily: SANS, fontSize: 11, lineHeight: 15, color: c.warn },
    markAbandoned: { fontFamily: SANS, fontSize: 11, lineHeight: 15, color: c.fgFaint },
    taskDone: { flex: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: c.fgFaint, textDecorationLine: "line-through" },
    taskActive: { flex: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: c.fg },
    taskBlocked: { flex: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: c.warn },
    blocker: { color: c.fgFaint },
  } as const;
}
