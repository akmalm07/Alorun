import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  proposalSchema,
  type Goal,
  type Proposal,
  type TaskDraft,
  type Window,
  type Task,
} from "../shared/contracts";
import { api, newId } from "./client";
import { scheduleTasks, taskWindow } from "../domain/schedule";
import { Button, ErrorMessage, Field, styles } from "./ui";

type Slot = { id: string; day: string; time: string; minutes: string };
const dateLabel = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function defaultSlot(): Slot {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    id: newId(),
    day: dateLabel(tomorrow),
    time: "18:00",
    minutes: "60",
  };
}
export function slotToWindow(slot: Slot): Window {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(slot.day) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time)
  )
    throw new Error("Use YYYY-MM-DD for dates and HH:MM for times.");
  const start = new Date(`${slot.day}T${slot.time}:00`);
  const minutes = Number(slot.minutes);
  if (
    !Number.isFinite(start.getTime()) ||
    dateLabel(start) !== slot.day ||
    `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}` !==
      slot.time
  )
    throw new Error("That local time does not exist. Choose another time.");
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480)
    throw new Error("Choose between 5 and 480 available minutes per slot.");
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + minutes * 60_000).toISOString(),
  };
}
export function PlanBuilder({
  goal,
  onClose,
}: {
  goal: Goal;
  onClose: () => void;
}) {
  const [slots, setSlots] = useState<Slot[]>(() => [defaultSlot()]);
  const query = useQueryClient();
  const generate = useMutation({
    mutationFn: async () =>
      proposalSchema.parse(
        await api("/plans/propose", "POST", {
          goalId: goal.id,
          requestId: newId(),
          windows: slots.map(slotToWindow),
        }),
      ),
    onSuccess: async () => {
      await query.invalidateQueries({ queryKey: ["today"] });
      onClose();
    },
  });
  function update(id: string, key: keyof Slot, value: string) {
    setSlots((old) =>
      old.map((s) => (s.id === id ? { ...s, [key]: value } : s)),
    );
  }
  return (
    <View style={styles.inset}>
      <Text style={styles.heading}>Make time for {goal.title}</Text>
      <Text style={styles.muted}>
        Choose times you’re free in{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}. AI will propose
        tasks; review them before adding them to your schedule.
      </Text>
      {slots.map((slot) => (
        <View key={slot.id} style={{ gap: 10 }}>
          <Field
            label="Date (YYYY-MM-DD)"
            value={slot.day}
            onChangeText={(v) => update(slot.id, "day", v)}
            editable={!generate.isPending}
          />
          <View style={styles.row}>
            <Field
              label="Start (HH:MM)"
              value={slot.time}
              onChangeText={(v) => update(slot.id, "time", v)}
              editable={!generate.isPending}
            />
            <Field
              label="Available minutes"
              value={slot.minutes}
              keyboardType="number-pad"
              onChangeText={(v) => update(slot.id, "minutes", v)}
              editable={!generate.isPending}
            />
          </View>
          {slots.length > 1 && (
            <Button
              title="Remove time slot"
              secondary
              disabled={generate.isPending}
              onPress={() =>
                setSlots((old) => old.filter((s) => s.id !== slot.id))
              }
            />
          )}
        </View>
      ))}
      <ErrorMessage error={generate.error} />
      <Button
        title="Add another time slot"
        secondary
        disabled={generate.isPending || slots.length >= 31}
        onPress={() => setSlots((old) => [...old, defaultSlot()])}
      />
      <Button
        title={
          generate.isPending
            ? "Creating your proposal…"
            : "Ask AI to plan this goal"
        }
        disabled={generate.isPending}
        onPress={() => generate.mutate()}
      />
      <Button
        title="Cancel"
        secondary
        disabled={generate.isPending}
        onPress={onClose}
      />
    </View>
  );
}
export function PlanReview({
  proposal,
  existingTasks,
}: {
  proposal: Proposal;
  existingTasks: Task[];
}) {
  const [drafts, setDrafts] = useState<TaskDraft[]>(() =>
    proposal.tasks.map(({ title, description, estimateMinutes }) => ({
      title,
      description,
      estimateMinutes,
    })),
  );
  const query = useQueryClient();
  const decision = useMutation({
    mutationFn: (action: "accept" | "reject") =>
      api(
        `/plans/${proposal.id}/${action}`,
        "POST",
        action === "accept" ? { tasks: drafts } : undefined,
      ),
    onSuccess: () => query.invalidateQueries({ queryKey: ["today"] }),
  });
  const valid =
    drafts.length > 0 &&
    drafts.every(
      (d) =>
        d.title.trim() &&
        Number.isInteger(d.estimateMinutes) &&
        d.estimateMinutes >= 5 &&
        d.estimateMinutes <= 240,
    );
  let preview: ReturnType<typeof scheduleTasks> = [];
  let scheduleError: unknown;
  try {
    preview = scheduleTasks(
      drafts,
      proposal.windows,
      existingTasks
        .filter((t) => t.status !== "completed")
        .flatMap((t) => {
          const w = taskWindow(t);
          return w ? [w] : [];
        }),
      new Date(),
    );
  } catch (e) {
    scheduleError = e;
  }
  return (
    <View style={styles.inset}>
      <Text style={styles.heading}>Review your plan</Text>
      <Text style={styles.body}>{proposal.rationale}</Text>
      <Text style={styles.muted}>
        Nothing is scheduled yet. Edit or remove tasks, then approve. Times are
        checked again when you approve.
      </Text>
      <Text style={styles.body}>Available times</Text>
      {proposal.windows.map((window) => (
        <Text key={window.start} style={styles.muted}>
          {new Date(window.start).toLocaleString([], {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
          –
          {new Date(window.end).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </Text>
      ))}
      <Text style={styles.muted}>
        Tasks run in order in these slots. Edits may change their times.
      </Text>
      {drafts.map((draft, i) => (
        <View key={i} style={styles.section}>
          {preview[i] && (
            <Text style={styles.body}>
              {new Date(preview[i].start).toLocaleString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
              –
              {new Date(preview[i].end).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          )}
          <Field
            label={`Task ${i + 1}`}
            value={draft.title}
            editable={!decision.isPending}
            onChangeText={(title) =>
              setDrafts((old) =>
                old.map((d, n) => (n === i ? { ...d, title } : d)),
              )
            }
          />
          <Field
            label="Next step"
            value={draft.description}
            multiline
            editable={!decision.isPending}
            onChangeText={(description) =>
              setDrafts((old) =>
                old.map((d, n) => (n === i ? { ...d, description } : d)),
              )
            }
          />
          <Field
            label="Estimated minutes"
            value={
              Number.isNaN(draft.estimateMinutes)
                ? ""
                : String(draft.estimateMinutes)
            }
            keyboardType="number-pad"
            editable={!decision.isPending}
            onChangeText={(v) =>
              setDrafts((old) =>
                old.map((d, n) =>
                  n === i
                    ? { ...d, estimateMinutes: v.trim() ? Number(v) : NaN }
                    : d,
                ),
              )
            }
          />
          <Button
            title="Remove task"
            secondary
            disabled={decision.isPending}
            onPress={() => setDrafts((old) => old.filter((_, n) => n !== i))}
          />
        </View>
      ))}
      <ErrorMessage error={scheduleError} />
      <ErrorMessage error={decision.error} />
      <Button
        title={decision.isPending ? "Saving…" : "Approve and add to calendar"}
        disabled={decision.isPending || !valid || Boolean(scheduleError)}
        onPress={() => decision.mutate("accept")}
      />
      <Button
        title="Discard proposal"
        secondary
        disabled={decision.isPending}
        onPress={() => decision.mutate("reject")}
      />
    </View>
  );
}
