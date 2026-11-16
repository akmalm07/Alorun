---
name: Alorun
description: Existing Expo native visual system for goals, plans, calendar tasks, and voice check-ins.
colors:
  background: "#f7f8fc"
  ink: "#252a40"
  muted: "#5c637b"
  accent: "#354f43"
  border: "#d4d9e1"
  soft: "#e9efe9"
  error: "#9c3030"
  secondary: "#e4e8ef"
  white: "#fff"
typography:
  title:
    fontSize: "32"
    fontWeight: 700
  heading:
    fontSize: "23"
    fontWeight: 600
  body:
    fontSize: "16"
    lineHeight: 24
  muted:
    fontSize: "15"
    lineHeight: 22
  label:
    fontSize: "15"
    fontWeight: 600
  button:
    fontSize: "16"
    fontWeight: 600
  calendar-day:
    fontSize: "22"
    fontWeight: 600
  calendar-weekday:
    fontSize: "14"
  calendar-count:
    fontSize: "13"
rounded:
  input: "10"
  button: "12"
  inset: "14"
spacing:
  calendar-label-gap: "6"
  field-gap: "7"
  task-gap: "8"
  row-gap: "10"
  control-padding: "12"
  section-gap: "14"
  content-gap: "18"
  section-top: "20"
  screen-padding: "24"
  content-bottom: "64"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "12 18"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "12 18"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "{spacing.control-padding}"
  inset:
    backgroundColor: "{colors.soft}"
    rounded: "{rounded.inset}"
    padding: "{spacing.content-gap}"
  calendar-day:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "{spacing.control-padding}"
  calendar-day-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    rounded: "{rounded.button}"
    padding: "{spacing.control-padding}"
---

# Design System: Alorun

## Overview

This is a code-derived record of the existing React Native / Expo interface. It preserves the native typeface, pale background, dark ink, muted supporting text, and green actions already implemented. It introduces no creative direction or replacement identity.

Extraction sources: `src/mobile/ui.tsx`, `Today.tsx`, `PlanBuilder.tsx`, `VoiceCheckin.tsx`, `Companion.tsx`, `useCompanion.ts`, `useVoiceCapture.ts`, `app/companion.tsx`, `Missions.tsx`, `app/missions.tsx` (screen routes), and `src/shared/missions.ts` (mission labels and input limits). No rendered native screenshots were available; this document does not imply visual approval or device verification. No native UI detector was run. Token dimensions are React Native logical units, not CSS pixels; font sizes follow native text scaling. No explicit font family is configured in these sources, so use the platform default.

**Key Characteristics:**

- Native controls and text with a single scrolling content column.
- Flat surfaces separated by spacing, borders, and soft fills.
- Shared controls across goal planning, plan review, scheduled tasks, optional voice check-ins, text or voice conversation, and recurring missions.

## Colors

### Primary

`accent` fills primary actions and selected calendar days. The enabled voice preference switch uses the same accent track.

### Neutral

`background` is the shared screen background. `ink` carries headings, body copy, labels, and secondary action text. `muted` carries explanatory copy, schedule metadata, and placeholders. `border` separates sections and tasks and outlines fields. `white` fills fields and supplies primary action text. `secondary` fills secondary buttons and unselected calendar days. `soft` groups planning, review, and check-in content.

The semantic `error` color is reserved for shared error messages. Palette values in frontmatter are normative; no additional tonal ramp is defined in the source.

## Typography

Use the native platform typeface. There is no separate display face, web font, or custom font stack in the extracted implementation.

The hierarchy uses `title` for Today, Companion, and Missions, `heading` for sections and inset headings, `body` for task content and primary explanations, `muted` for supporting context, `label` above fields, and `button` for centered action text. Task and goal titles reuse body size with semibold weight. Calendar weekday, date, and task count use their dedicated roles.

Only body and supporting text explicitly define line height. Preserve native defaults for the other roles. Error text uses the muted role's size and line height with the semantic error color.

## Layout

The shared content container occupies the available width, caps at 680 logical units, centers itself, and uses the frontmatter screen padding, content gap, and bottom spacing. Today is a vertical `ScrollView` with pull to refresh and keyboard taps handled. Rows wrap, center their children, and use the row gap. Fields grow to share available row space.

Sections use a top divider and section spacing. Goal rows use vertical padding and a gap of 10; task rows use the task gap and vertical padding of 14. Calendar dates form a horizontally scrollable seven-day strip with an 8-unit gap. Each date has a minimum width of 66 and minimum height of 96. No breakpoint system is defined in the inspected code.

Shared buttons and fields have a minimum height of 48 logical units. Preserve that minimum for new action controls. Native switch sizing remains platform-managed.

## Elevation & Depth

No shadows or explicit elevation are defined in these sources. Grouping comes from the background, soft inset surfaces, secondary fills, and single-unit borders. Plan and voice panels are inline native views; they are not floating web dialogs.

## Shapes

Use the extracted input, button, and inset radius roles. Calendar dates reuse the button radius. Fields have a one-unit border. Sections have a top border, and task rows have a bottom border. The observed system uses gently rounded controls and panels with flat list separators.

## Components

### Buttons

Shared `Pressable` buttons center their labels, use the primary or secondary frontmatter variant, and enforce the minimum action height. Both pressed and disabled states apply opacity 0.55. They expose button semantics and disabled state. No custom hover, focus ring, transition, or animation is defined; preserve native platform behavior rather than documenting web states.

### Inputs / Fields

`Field` places a visible label above a native `TextInput`, with the field gap between them. Inputs use a white fill, border outline, ink text, muted placeholders, and control padding. Labels also supply the accessibility label. Multiline and numeric keyboard modes are passed through by the consuming form. No separate custom focus or error-border style is defined.

### Cards / Containers

The shared inset groups the plan builder, plan review, voice check-in, assistant messages, active voice conversation, dictation conflict panel, and mission form or detail. It uses the soft surface, inset corners, content-gap padding, and section gap between children. Sections use dividers rather than independent card shells.

### Navigation

Calendar week navigation uses the shared secondary buttons. Calendar day controls show weekday, numeric date, and task count, switching fill and text roles when selected. They expose selected state and a full-date accessibility label. Companion uses a shared secondary “Back to Today” button and native hardware-back handling; `app/companion.tsx` exports that screen. Today also links to Missions and goal-filtered mission suggestions through shared secondary buttons. The Missions screen provides a shared secondary “Back to Today” action; its list is replaced by the mission form or detail while open. No tab bar or additional navigation-shell styling was inspected for this extraction.

### Task Rows

Task rows stack time and duration, semibold task title, optional goal name, description, error feedback, and a secondary completion action. Completed task titles receive a line-through. The action changes between completion and reopening states; saving uses a disabled pending label.

### Plan Review

The soft inset displays rationale and available times, followed by editable task sections. Task title, next step, estimated minutes, and removal reuse shared controls. Approving and discarding use the primary and secondary variants respectively. Pending and invalid states disable actions; schedule errors use the shared error component.

### Voice Check-in

The soft inset contains a heading, question, disclosure, and conditional recording status. Record, stop, and send use shared primary actions; “Not now” uses secondary. Actions wrap in a shared row and disable while busy. Recording progress uses a polite accessibility live region. The preference is a native switch with an accent enabled track.

### Companion Conversation

Companion reuses the shared scrolling content container, title, wrapping rows, text roles, fields, buttons, and section dividers. Conversation modes use primary styling for the selected mode and secondary styling for the others. Assistant messages use the soft inset; user messages use the section divider. Semibold role labels identify each speaker and show dictated or voice-transcript provenance. Message content is selectable native text.

Dictation converts a recorded clip to the multiline Message field for editing before the separate Send message action. The active voice panel uses the existing inset, heading, body, and muted roles, with shared actions for stopping speech and ending voice chat. Ending merges completed voice entries into the visible text conversation. Recording, processing, and speaking states use polite native live-region text. History saving uses a native switch with the accent enabled track; clearing opens a native confirmation alert. These patterns add no palette, font, spacing, shape, elevation, or motion tokens.

### Dictation Conflict Panel

When adding recognized text would exceed the message limit, an existing soft inset presents a heading, explanation, selectable dictated text, a primary replacement action, and a secondary action to keep the current draft. It is an inline native panel using existing components, not a new modal style. The current draft remains editable after the choice.

### Missions

Missions reuses the shared native scrolling content container, title, body and supporting text, section dividers, inset panels, fields, buttons, switches, and loading/error feedback. The list presents goal-based suggestions and approved missions as divided stacks. Opening a suggestion or creating a mission replaces the list with the form; opening a mission replaces it with detail. Cancel or Close mission returns to the list. These views share the screen header and use a keyed scroll container rather than a new modal or side panel.

The form uses primary buttons for the selected goal, document type, and schedule preset; unselected choices use secondary buttons. Schedule presets are daily, weekdays, or Mondays at 9 am, with a visible timezone field. An optional advanced section exposes a five-field cron input and explanatory text. A secondary preview action displays the next three run times in body text. Native switches with the existing accent enabled track separately control activation and approval. Approval remains unavailable until the current schedule has a valid preview; editing the definition resets approval. Saving uses the primary action, with pending or invalid conditions disabling it. Private folder naming and runner unavailability use existing supporting text, without new status colors.

Detail uses an inset with active or paused status, next run, schedule, instructions, and a selectable private storage path. Shared controls pause or activate the mission and queue a run. Divided sections present input files and recent runs. File names accept text, Markdown, or JSON extensions; the content field is multiline with a 16,000-character limit. Supporting copy explains the 10-file maximum, replacement by existing name, and that each run reads the first four files alphabetically and the first 4,000 characters of each. File reading opens selectable plain native text with shared edit or close actions; generated documents reuse that reader.

Run labels are “Queued”, “Preparing document”, “Document ready”, “Could not finish”, and “Cancelled”. They use existing label typography; schedule metadata uses muted text, summaries use body text, and errors use the shared error style. Generated artifacts receive a secondary reading action. Queuing and file-saving confirmations use polite live-region supporting text. Unavailable runner or storage states explain the limitation and disable relevant actions. No new palette, typography, spacing, shape, elevation, or motion tokens are introduced.

### Feedback

Errors are native `Text` with alert semantics and the error color. Loading uses a native `ActivityIndicator`. Pending operations communicate through action labels and disabled states; no extra animation system was extracted.
