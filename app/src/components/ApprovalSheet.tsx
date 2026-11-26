import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors, SANS, radius } from "../theme";
import { t } from "../i18n/index.ts";
import { approvalText, optionLabel } from "../ompText";
import {
  approvalForm,
  initialApprovalDraft,
  approvalErrors,
  approvalResponse,
  setChoice,
  hasSensitiveFields,
  type ApprovalDraft,
} from "../approvalForms";
import { loadApprovalDraft, saveApprovalDraft } from "../approvalDrafts";
import type { ApprovalAnswer, ApprovalRequest, Machine } from "../types";
import type { ChoiceField, FormField } from "../../vendor/omp-form/parse.ts";
import {
  SheetGrab,
  SheetHost,
  SheetSurface,
  useSheet,
  sheetSurface,
} from "./ui";
import { remoteFormImage } from "../approvalMedia";
import { ApprovalBlock, ApprovalSpans } from "./ApprovalContent";

/** Native presentation of OMP's six dialog methods. Closing the view never answers the question. */
export function ApprovalSheet({
  request,
  onAnswer,
  onDismiss,
  machine,
  sessionId,
  connected,
  busy = false,
  error,
  canValidate = false,
}: {
  request: ApprovalRequest;
  onAnswer: (answer: ApprovalAnswer) => void;
  onDismiss: () => void;
  machine: Machine;
  sessionId: string;
  connected: boolean;
  busy?: boolean;
  error?: string;
  canValidate?: boolean;
}): ReactNode {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const sheet = useSheet(true, dismiss);
  const parsed = useMemo(() => {
    try {
      return { form: approvalForm(request) };
    } catch {
      return { failed: true };
    }
  }, [request.method, request.html, request.questions]);
  const form = parsed.form;
  const [draft, setDraft] = useState<ApprovalDraft>(() =>
    initialApprovalDraft(request, form),
  );
  const [ready, setReady] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageFailed, setImageFailed] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now());
  const latest = useRef({ draft, ready });
  latest.current = { draft, ready };
  function dismiss() {
    if (ready && !sensitive)
      void saveApprovalDraft(machine.id, sessionId, request, draft).catch(
        () => {},
      );
    onDismiss();
  }
  useEffect(
    () => () => {
      if (latest.current.ready && !hasSensitiveFields(request, parsed.form))
        void saveApprovalDraft(
          machine.id,
          sessionId,
          request,
          latest.current.draft,
        ).catch(() => {});
    },
    [],
  );
  const sensitive = hasSensitiveFields(request, form);
  const changed = useRef(false);
  const change = (next: ApprovalDraft) => {
    changed.current = true;
    latest.current = { draft: next, ready };
    setDraft(next);
  };
  useEffect(() => {
    let live = true;
    if (sensitive) {
      setReady(true);
      return;
    }
    void loadApprovalDraft(machine.id, sessionId, request)
      .then((saved) => {
        if (live) {
          if (saved && !changed.current) setDraft(saved);
          setReady(true);
        }
      })
      .catch(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || sensitive || !changed.current) return;
    const timer = setTimeout(
      () =>
        void saveApprovalDraft(machine.id, sessionId, request, draft).catch(
          () => {},
        ),
      200,
    );
    return () => clearTimeout(timer);
  }, [draft, ready, sensitive]);
  useEffect(() => {
    if (request.expiresAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [request.expiresAt]);
  const mediaReady = useCallback(
    (src: string) =>
      setLoadedImages((current) => ({ ...current, [src]: true })),
    [],
  );
  const mediaPending =
    form?.sections.some((section) =>
      section.blocks.some(
        (block) =>
          block.kind === "image" &&
          !remoteFormImage(block.src) &&
          !loadedImages[block.src],
      ),
    ) === true;
  const mediaFailure = useCallback(() => setImageFailed(true), []);
  const expired = request.expiresAt !== undefined && now >= request.expiresAt;
  const requiresUpgrade =
    (request.method === "form" || request.method === "ask") && !canValidate;
  const supported =
    form !== undefined ||
    ["select", "confirm", "input", "editor"].includes(request.method);
  const disabled =
    !connected ||
    busy ||
    !ready ||
    expired ||
    imageFailed ||
    mediaPending ||
    requiresUpgrade ||
    parsed.failed === true;
  const text = approvalText(request.title, request.message);
  const button = (
    label: string,
    press: () => void,
    opts: {
      disabled?: boolean;
      selected?: boolean;
      danger?: boolean;
      description?: string;
      key?: string;
    } = {},
  ) => (
    <Pressable
      key={opts.key ?? label}
      onPress={press}
      disabled={disabled || opts.disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled: disabled || opts.disabled === true,
        selected: opts.selected,
      }}
      style={({ pressed }) => ({
        padding: 14,
        minHeight: 50,
        gap: 5,
        borderRadius: radius.md,
        backgroundColor: opts.selected ? c.selected : c.inset,
        opacity: disabled || opts.disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          fontFamily: SANS,
          fontSize: 16,
          color: opts.danger ? c.sysRed : c.tint,
        }}
      >
        {opts.selected ? "✓  " : ""}
        {label}
      </Text>
      {opts.description ? (
        <Text style={{ color: c.fgMuted, fontSize: 13 }}>
          {opts.description}
        </Text>
      ) : null}
    </Pressable>
  );
  const input = (
    name: string,
    value: string,
    onChange: (s: string) => void,
    opts: {
      secret?: boolean;
      multiline?: boolean;
      placeholder?: string;
      numeric?: boolean;
    } = {},
  ) => (
    <TextInput
      accessibilityLabel={name}
      value={value}
      onChangeText={onChange}
      editable={!disabled}
      secureTextEntry={opts.secret}
      multiline={opts.multiline}
      placeholder={opts.placeholder}
      placeholderTextColor={c.fgFaint}
      keyboardType={opts.numeric ? "numeric" : "default"}
      autoCapitalize="none"
      autoCorrect={false}
      style={{
        fontFamily: SANS,
        color: c.fg,
        backgroundColor: c.inset,
        padding: 12,
        borderWidth: 1,
        borderColor: Object.hasOwn(errors, name) ? c.sysRed : c.borderStrong,
        borderRadius: radius.md,
        minHeight: opts.multiline ? 100 : 48,
        textAlignVertical: "top",
      }}
    />
  );
  const choice = (field: ChoiceField) => (
    <View style={{ gap: 8 }}>
      {field.options.map((option, index) => (
        <View key={String(index)}>
          {button(
            option.label.map((span) => span.text).join(""),
            () => change(setChoice(draft, field, index)),
            {
              disabled: option.disabled,
              selected: (draft.checked[field.name] ?? []).includes(index),
            },
          )}
        </View>
      ))}
      {field.other ? (
        <>
          {button(
            t("approval.other"),
            () => {
              const enabled = draft.usingOther[field.name] !== true;
              change({
                ...draft,
                usingOther: { ...draft.usingOther, [field.name]: enabled },
                checked:
                  enabled && !field.multi
                    ? { ...draft.checked, [field.name]: [] }
                    : draft.checked,
              });
            },
            { selected: draft.usingOther[field.name] === true },
          )}
          {draft.usingOther[field.name] === true
            ? input(
                `${field.name}:other`,
                typeof draft.others[field.name] === "string"
                  ? draft.others[field.name]!
                  : "",
                (value) =>
                  change({
                    ...draft,
                    others: { ...draft.others, [field.name]: value },
                  }),
              )
            : null}
        </>
      ) : null}
    </View>
  );
  const drawField = (field: FormField) => (
    <View style={{ gap: 8, marginVertical: 8 }}>
      {field.label.length ? <ApprovalSpans spans={field.label} /> : null}
      {field.required ? (
        <Text style={{ color: c.fgMuted, fontSize: 12 }}>
          {t("approval.required")}
        </Text>
      ) : null}
      {field.kind === "choice"
        ? choice(field)
        : input(
            field.name,
            String(draft.values[field.name] ?? ""),
            (value) =>
              change({
                ...draft,
                values: { ...draft.values, [field.name]: value },
              }),
            {
              multiline: field.multiline,
              secret: field.type === "password",
              placeholder: field.placeholder,
              numeric: field.type === "number" || field.type === "range",
            },
          )}
      {Object.hasOwn(errors, field.name) ? (
        <Text accessibilityRole="alert" style={{ color: c.sysRed }}>
          {errors[field.name]}
        </Text>
      ) : null}
    </View>
  );
  const submit = () => {
    if (disabled) return;
    if (form) {
      const found = approvalErrors(form, draft);
      setErrors(found);
      if (Object.keys(found).length) return;
    }
    onAnswer(approvalResponse(request, form, draft));
  };
  return (
    <SheetHost sheet={sheet} modal={false} backdropLabel={t("approval.close")}>
      <SheetSurface
        skirt={c.overlay}
        style={{
          ...sheetSurface(c),
          maxHeight: "94%",
          paddingHorizontal: 16,
          paddingBottom: 10 + insets.bottom,
          gap: 10,
        }}
      >
        <SheetGrab style={{ alignItems: "center", padding: 12 }}>
          <View
            style={{
              width: 38,
              height: 5,
              borderRadius: 3,
              backgroundColor: c.fgFaint,
            }}
          />
        </SheetGrab>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
        >
          <Text
            style={{
              fontFamily: SANS,
              fontSize: 19,
              fontWeight: "600",
              color: c.fg,
            }}
          >
            {text.heading}
          </Text>
          {request.expiresAt !== undefined ? (
            <Text style={{ color: expired ? c.sysRed : c.fgMuted }}>
              {expired
                ? t("approval.expired")
                : t("approval.expires", {
                    seconds: Math.max(
                      0,
                      Math.ceil((request.expiresAt - now) / 1000),
                    ),
                  })}
            </Text>
          ) : null}
          {request.timeout !== undefined ? (
            <Text style={{ color: c.fgMuted, fontSize: 12 }}>
              {t("approval.remoteTimeout")}
            </Text>
          ) : null}
          {text.details.map((d, i) => (
            <Text key={i} selectable style={{ color: c.fg }}>
              {d.label ? `${d.label}: ` : ""}
              {d.value}
            </Text>
          ))}
          {parsed.failed ? (
            <Text style={{ color: c.sysRed }}>{t("approval.parseError")}</Text>
          ) : null}
          {!supported && !parsed.failed ? (
            <Text style={{ color: c.fgMuted }}>
              {t("approval.unsupported")}
            </Text>
          ) : null}
          {requiresUpgrade ? (
            <Text style={{ color: c.sysRed }}>{t("approval.upgrade")}</Text>
          ) : null}
          {form?.sections.map((section, i) => (
            <View key={i} style={{ gap: 10 }}>
              {section.title.length ? (
                <Text style={{ fontSize: 18, fontWeight: "600", color: c.fg }}>
                  <ApprovalSpans spans={section.title} />
                </Text>
              ) : null}
              {section.blocks.map((block, j) => (
                <View key={j}>
                  {block.kind === "field" ? (
                    drawField(block.field)
                  ) : (
                    <ApprovalBlock
                      block={block}
                      request={request}
                      machine={machine}
                      onFailure={mediaFailure}
                      onReady={mediaReady}
                    />
                  )}
                </View>
              ))}
            </View>
          ))}
          {request.method === "select"
            ? (request.options ?? []).map((option, i) =>
                button(optionLabel(option), () => onAnswer({ value: option }), {
                  key: String(i),
                  selected:
                    request.selectionMarker === "checkbox"
                      ? request.checkedIndices?.includes(i)
                      : request.initialIndex === i,
                  description: request.optionDetails?.[i]?.description,
                }),
              )
            : null}
          {request.method === "confirm" ? (
            <>
              {button(t("approval.yes"), () => onAnswer({ confirmed: true }))}
              {button(t("approval.no"), () => onAnswer({ confirmed: false }), {
                danger: true,
              })}
            </>
          ) : null}
          {request.method === "input" || request.method === "editor"
            ? input(
                "answer",
                draft.text,
                (value) => change({ ...draft, text: value }),
                {
                  secret: request.secret,
                  multiline:
                    request.method === "editor" && !request.promptStyle,
                  placeholder: request.placeholder,
                },
              )
            : null}
        </ScrollView>
        {error || Object.keys(errors).length ? (
          <Text accessibilityRole="alert" style={{ color: c.sysRed }}>
            {error ??
              Object.entries(errors)
                .map(([name, message]) => `${name}: ${message}`)
                .join(" · ")}
          </Text>
        ) : null}
        {!connected ? (
          <Text style={{ color: c.sysRed }}>{t("approval.offline")}</Text>
        ) : null}
        {mediaPending && !imageFailed ? (
          <Text style={{ color: c.fgMuted }}>
            {t("approval.imagesLoading")}
          </Text>
        ) : null}
        {form || request.method === "input" || request.method === "editor"
          ? button(busy ? t("approval.pending") : t("approval.submit"), submit)
          : null}
        <View
          style={{
            flexDirection: "row",
            gap: 12,
            justifyContent: "space-between",
            paddingVertical: 8,
          }}
        >
          <Pressable accessibilityRole="button" onPress={dismiss}>
            <Text style={{ color: c.tint, padding: 8 }}>
              {t("approval.close")}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy || !connected}
            onPress={() => onAnswer({ cancelled: true })}
          >
            <Text
              style={{
                color: c.sysRed,
                padding: 8,
                opacity: busy || !connected ? 0.5 : 1,
              }}
            >
              {t("approval.cancelRequest")}
            </Text>
          </Pressable>
        </View>
      </SheetSurface>
    </SheetHost>
  );
}
