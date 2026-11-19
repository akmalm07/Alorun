import { controlSchema, normalizeLabel, type Control } from "./plans";
import { webUrl } from "./protocol";

const pageControls =
  'a[href],button,[role="button"],[role="link"],input[type="button"],input[type="submit"],summary';
const pageFields =
  'input:not([type]),input[type="text"],input[type="search"],textarea,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
const sensitive =
  /\b(password|passcode|otp|one[ -]time|verification code|auth(?:entication)? code|security code|secret|credential|credit card|card number|cvc|cvv|payment|bank account|social security|login|sign[ -]?in|sign[ -]?up|log[ -]?in)\b/i;
const commitment =
  /\b(delete|destroy|erase|remove|sign[ -]?out|log[ -]?out|send|purchase|buy|pay|checkout|submit|publish|confirm|approve|transfer|accept|authorize|invite|place order)\b/i;

export function visible(element: HTMLElement) {
  if (
    !element.isConnected ||
    element.closest(
      '[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"],:disabled',
    )
  )
    return false;
  const { width, height } = element.getBoundingClientRect();
  return (
    width > 0 &&
    height > 0 &&
    element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  );
}

function labels(element: HTMLElement, field = false) {
  const reference = element
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
  const associated =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
      ? [...(element.labels ?? [])]
          .map((label) => label.textContent ?? "")
          .join(" ")
      : "";
  return [
    reference,
    element.getAttribute("aria-label"),
    associated,
    element instanceof HTMLInputElement && element.type === "button"
      ? element.value
      : "",
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
      ? element.placeholder
      : "",
    field ? "" : element.innerText,
    element.getAttribute("title"),
    element.getAttribute("name"),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().replace(/\s+/g, " "));
}

function onSensitiveForm(element: HTMLElement) {
  const form = element.closest("form");
  return Boolean(
    form?.querySelector(
      'input[type="password"],input[autocomplete^="cc-"],input[autocomplete="one-time-code"]',
    ),
  );
}

function safeControl(element: HTMLElement): Control | undefined {
  if (
    !visible(element) ||
    onSensitiveForm(element) ||
    (element instanceof HTMLButtonElement &&
      element.form &&
      element.type === "submit") ||
    (element instanceof HTMLInputElement && element.type === "submit") ||
    element.getAttribute("role") === "menuitemcheckbox"
  )
    return;
  const names = labels(element);
  if (
    !names.length ||
    names.some((name) => sensitive.test(name) || commitment.test(name))
  )
    return;
  if (element instanceof HTMLAnchorElement) {
    const url = webUrl(element.href);
    if (
      !url ||
      url.origin !== location.origin ||
      element.hasAttribute("download") ||
      (element.target && element.target !== "_self")
    )
      return;
  }
  const result = controlSchema.safeParse({
    label: names[0],
    kind: element.matches("a[href],[role=link]") ? "link" : "button",
  });
  if (result.success) return result.data;
}

export function availableControls() {
  const found = new Map<string, Control>();
  const ambiguous = new Set<string>();
  for (const element of document.querySelectorAll<HTMLElement>(pageControls)) {
    if (!(element instanceof HTMLElement)) continue;
    const control = safeControl(element);
    if (!control) continue;
    const key = normalizeLabel(control.label) + ":" + control.kind;
    if (found.has(key)) ambiguous.add(key);
    else found.set(key, control);
  }
  return [...found]
    .filter(([key]) => !ambiguous.has(key))
    .slice(0, 100)
    .map(([, control]) => control);
}

function clickMatches(label: string, kind?: Control["kind"]) {
  return [...document.querySelectorAll<HTMLElement>(pageControls)].filter(
    (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const control = safeControl(element);
      return (
        control &&
        (!kind || control.kind === kind) &&
        normalizeLabel(control.label) === normalizeLabel(label)
      );
    },
  );
}

export function findShortcut(control: Control) {
  const matches = clickMatches(control.label, control.kind);
  return matches.length === 1 ? matches[0] : undefined;
}

function safeField(element: HTMLElement) {
  if (
    !visible(element) ||
    onSensitiveForm(element) ||
    element.hasAttribute("readonly") ||
    element.getAttribute("aria-readonly") === "true"
  )
    return false;
  const autocomplete = element.getAttribute("autocomplete") ?? "";
  return (
    !/\b(?:password|one-time-code|cc-[\w-]+|username)\b/.test(autocomplete) &&
    ![...labels(element, true), element.id, element.className].some((name) =>
      sensitive.test(name.replace(/[-_]/g, " ")),
    )
  );
}

export function findActionTarget(kind: "click" | "type", label: string) {
  const matches =
    kind === "click"
      ? clickMatches(label)
      : [...document.querySelectorAll<HTMLElement>(pageFields)].filter(
          (element) =>
            element instanceof HTMLElement &&
            safeField(element) &&
            labels(element, true).some(
              (name) => normalizeLabel(name) === normalizeLabel(label),
            ),
        );
  if (matches.length > 1)
    throw new Error(`“${label}” matches more than one control.`);
  if (!matches.length)
    throw new Error(
      `No available ${kind === "click" ? "button or link" : "text field"} is labeled “${label}”.`,
    );
  return matches[0];
}
