import { z } from "zod";

export const labelSchema = z.string().trim().min(1).max(100);
export const controlSchema = z.object({
  label: labelSchema,
  kind: z.enum(["link", "button"]),
});
export const layoutSchema = z.object({
  shortcuts: z.array(controlSchema).max(8),
  position: z.enum(["top", "bottom"]),
  density: z.enum(["comfortable", "compact"]),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  first: z.enum(["shortcuts", "visits"]),
});
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), target: labelSchema }),
  z.object({
    kind: z.literal("type"),
    target: labelSchema,
    text: z.string().min(1).max(200),
  }),
]);
export const actionsSchema = z.array(actionSchema).min(1).max(6);
export type Control = z.infer<typeof controlSchema>;
export type Layout = z.infer<typeof layoutSchema>;
export type PageAction = z.infer<typeof actionSchema>;

export function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").normalize("NFKC").toLowerCase();
}

const sameLabel = (left: Control, right: Control) =>
  normalizeLabel(left.label) === normalizeLabel(right.label) &&
  left.kind === right.kind;

export function draftLayout(
  prompt: string,
  controls: Control[],
  previous?: Layout,
): { layout: Layout; message: string } {
  const text = normalizeLabel(prompt);
  const quoted = Array.from(prompt.matchAll(/"([^"]+)"|“([^”]+)”/g), (match) =>
    normalizeLabel(match[1] ?? match[2]),
  );
  const hasLayoutVerb =
    /\b(add|include|pin|put|show|feature|keep|move|remove|hide|drop|use|prioriti[sz]e|highlight|buttons?|shortcuts?|want|need)\b/.test(
      text,
    );
  const requested = controls
    .map((control) => {
      const label = normalizeLabel(control.label);
      const index = text.indexOf(label);
      const isWholeLabel =
        index >= 0 &&
        !/[\p{L}\p{N}]/u.test(text[index - 1] ?? "") &&
        !/[\p{L}\p{N}]/u.test(text[index + label.length] ?? "");
      return {
        control,
        index:
          quoted.includes(label) || (hasLayoutVerb && isWholeLabel)
            ? index
            : -1,
      };
    })
    .filter(({ index }) => index >= 0)
    .sort(
      (a, b) =>
        a.index - b.index || b.control.label.length - a.control.label.length,
    )
    .filter(
      (item, index, all) =>
        !all
          .slice(0, index)
          .some(
            (earlier) =>
              earlier.index <= item.index &&
              earlier.index + earlier.control.label.length > item.index,
          ),
    )
    .map(({ control }) => control);
  const missing = quoted.filter(
    (label) =>
      !requested.some((control) => normalizeLabel(control.label) === label),
  );
  const removing = /\b(remove|hide|drop)\b/.test(text);
  const reset = /\b(reset|start over|default)\b/.test(text);
  const clear =
    /\b(?:no|remove all|hide all|clear) (?:buttons|shortcuts)\b/.test(text);
  const only = /\bonly\b/.test(text);
  const position = /\b(bottom|below|footer|at the end)\b/.test(text)
    ? "bottom"
    : /\b(top|above|header)\b/.test(text)
      ? "top"
      : undefined;
  const density = /\b(compact|dense|smaller|tight)\b/.test(text)
    ? "compact"
    : /\b(comfortable|spacious|roomy|larger)\b/.test(text)
      ? "comfortable"
      : undefined;
  const columnText = text.match(
    /\b(1|2|3|one|two|three|single)[ -]*columns?\b/,
  )?.[1];
  const columns =
    columnText === "3" || columnText === "three"
      ? 3
      : columnText === "2" || columnText === "two"
        ? 2
        : columnText
          ? 1
          : undefined;
  const visits = /\b(most[ -]visited|frequent(?:ly)?|popular pages)\b/.test(
    text,
  );
  const first =
    /(?:most[ -]visited|frequent(?:ly)?|popular pages).{0,22}\b(first|left|above the shortcuts)\b/.test(
      text,
    )
      ? "visits"
      : /(?:shortcuts|buttons).{0,22}\b(first|left|above most visited)\b/.test(
            text,
          )
        ? "shortcuts"
        : undefined;

  if (
    !requested.length &&
    !position &&
    !density &&
    !columns &&
    !visits &&
    !first &&
    !reset &&
    !clear
  ) {
    if (missing.length)
      throw new Error(
        `I couldn't find ${missing.map((label) => `“${label}”`).join(", ")} on this page. Check the labels and try again.`,
      );
    throw new Error(
      "Try a position, a column count, or the labels of links and buttons on this page.",
    );
  }

  const base = reset ? undefined : previous;
  const current = base?.shortcuts ?? [];
  const shortcuts = clear
    ? []
    : removing
      ? current.filter(
          (item) => !requested.some((control) => sameLabel(item, control)),
        )
      : requested.length
        ? [
            ...requested,
            ...(only
              ? []
              : current.filter(
                  (item) =>
                    !requested.some((control) => sameLabel(item, control)),
                )),
          ]
        : (base?.shortcuts ?? controls.slice(0, 4));
  const layout = layoutSchema.parse({
    shortcuts: shortcuts.slice(0, 8),
    position: position ?? base?.position ?? "top",
    density: density ?? base?.density ?? "comfortable",
    columns: columns ?? base?.columns ?? 2,
    first: first ?? base?.first ?? "shortcuts",
  });
  const count = layout.shortcuts.length;
  const summary = `Previewed a ${layout.density} panel at the ${layout.position} with ${count} ${count === 1 ? "shortcut" : "shortcuts"} and Most visited.`;
  return {
    layout,
    message: missing.length
      ? `${summary} I couldn't find ${missing.map((label) => `“${label}”`).join(", ")}.`
      : summary,
  };
}

const quotedText = /^"((?:\\["\\]|[^"\\])*)"/;
const unquote = (value: string) => value.replace(/\\(["\\])/g, "$1");

export function draftActions(prompt: string): PageAction[] {
  const example = 'Try: Click "New note" then type "Draft update" into "Note".';
  if (prompt.length > 1300)
    throw new Error("Keep the request under 1,300 characters.");
  let remaining = prompt.trim();
  const actions: PageAction[] = [];
  while (remaining && actions.length < 6) {
    const verb = remaining.match(/^(click|type)\s+/i)?.[0];
    if (!verb) throw new Error(example);
    const kind = verb.trim().toLowerCase();
    remaining = remaining.slice(verb.length);
    let text: string | undefined;
    if (kind === "type") {
      const value = remaining.match(quotedText);
      if (!value)
        throw new Error("Put the text you want typed in double quotes.");
      text = unquote(value[1]);
      remaining = remaining.slice(value[0].length);
      const into = remaining.match(/^\s+(?:into|in)\s+/i)?.[0];
      if (!into) throw new Error(example);
      remaining = remaining.slice(into.length);
    }
    const quoted = remaining.match(quotedText);
    const raw =
      quoted?.[0] ??
      remaining.match(/^[^";\n]+?(?=\s+(?:and\s+)?then\s+|[;\n]|$)/i)?.[0];
    if (!raw) throw new Error(example);
    const target = quoted
      ? unquote(quoted[1])
      : raw.trim().replace(/[.!]$/, "");
    actions.push(
      actionSchema.parse(
        kind === "click" ? { kind, target } : { kind, target, text },
      ),
    );
    remaining = remaining.slice(raw.length);
    if (!remaining.trim() || /^\s*[.!]\s*$/.test(remaining)) break;
    const delimiter = remaining.match(
      /^(?:\s*[,;\n]+\s*(?:then\s+)?|\s+(?:and\s+)?then\s+)/i,
    )?.[0];
    if (!delimiter) throw new Error(example);
    remaining = remaining.slice(delimiter.length);
    if (!remaining.trim()) throw new Error(example);
  }
  if (remaining.trim() && !/^\s*[.!]\s*$/.test(remaining))
    throw new Error("Review up to six actions at a time.");
  return actionsSchema.parse(actions);
}
