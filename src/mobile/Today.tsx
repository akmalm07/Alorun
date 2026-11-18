import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  checkinSchema,
  type Checkin,
  type Goal,
  type Task,
} from "../shared/contracts";
import { taskWindow } from "../domain/schedule";
import { api, loadToday, newId } from "./client";
import { useSession } from "./auth";
import { Button, colors, ErrorMessage, Field, styles } from "./ui";
import { PlanBuilder, PlanReview } from "./PlanBuilder";
import { MainNavigation } from "./MainNavigation";
import { VoiceCheckin } from "./VoiceCheckin";

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
const time = (date: Date) =>
  date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function TaskRow({ task, goal }: { task: Task; goal?: Goal }) {
  const query = useQueryClient();
  const update = useMutation({
    mutationFn: () =>
      api(`/tasks/${task.id}`, "PATCH", {
        status: task.status === "completed" ? "pending" : "completed",
      }),
    onSuccess: () => query.invalidateQueries({ queryKey: ["today"] }),
  });
  const window = taskWindow(task);
  return (
    <View
      style={{
        gap: 8,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      {window && (
        <Text style={styles.muted}>
          {new Date(window.start).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          })}{" "}
          · {time(new Date(window.start))}–{time(new Date(window.end))} ·{" "}
          {task.estimateMinutes} min
        </Text>
      )}
      <Text
        style={[
          styles.body,
          { fontWeight: "600" },
          task.status === "completed" && { textDecorationLine: "line-through" },
        ]}
      >
        {task.title}
      </Text>
      {goal && <Text style={styles.muted}>{goal.title}</Text>}
      {task.description && <Text style={styles.body}>{task.description}</Text>}
      <ErrorMessage error={update.error} />
      <Button
        title={
          update.isPending
            ? "Saving…"
            : task.status === "completed"
              ? "Reopen task"
              : "Mark complete"
        }
        secondary
        disabled={update.isPending}
        onPress={() => update.mutate()}
      />
    </View>
  );
}
export default function Today() {
  const session = useSession();
  const query = useQueryClient();
  const today = useQuery({
    queryKey: ["today", session?.user.id],
    queryFn: ({ signal }) => loadToday(signal),
  });
  const [title, setTitle] = useState("");
  const [motivation, setMotivation] = useState("");
  const [goalForm, setGoalForm] = useState(false);
  const [planning, setPlanning] = useState<Goal | null>(null);
  const [selected, setSelected] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const [checkin, setCheckin] = useState<Checkin | null>(null);
  const [checkinError, setCheckinError] = useState<unknown>();
  const focused = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );
  const opening = useRef(false);
  const enabled = useRef(false);
  const currentCheckin = useRef<Checkin | null>(null);
  currentCheckin.current = checkin;
  enabled.current = today.data?.checkinsEnabled ?? false;
  const addGoal = useMutation({
    mutationFn: () => api("/goals", "POST", { id: newId(), title, motivation }),
    onSuccess: async () => {
      setTitle("");
      setMotivation("");
      setGoalForm(false);
      await query.invalidateQueries({ queryKey: ["today"] });
    },
  });
  const preferences = useMutation({
    mutationFn: (value: boolean) =>
      api("/settings/goal-checkins", "PATCH", { enabled: value }),
    onSuccess: async (_data, value) => {
      if (!value) setCheckin(null);
      await query.invalidateQueries({ queryKey: ["today"] });
    },
  });
  async function openCheckin() {
    if (
      !focused.current ||
      !enabled.current ||
      opening.current ||
      currentCheckin.current
    )
      return;
    opening.current = true;
    setCheckinError(undefined);
    try {
      const result = z
        .object({ checkin: checkinSchema.nullable() })
        .parse(await api("/checkins/open", "POST", { requestId: newId() }));
      if (enabled.current && focused.current) setCheckin(result.checkin);
    } catch (e) {
      if (focused.current) setCheckinError(e);
    } finally {
      opening.current = false;
    }
  }
  useEffect(() => {
    if (today.data?.checkinsEnabled) void openCheckin();
  }, [today.data?.checkinsEnabled]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void query.invalidateQueries({ queryKey: ["today"] });
        void openCheckin();
      }
    });
    return () => listener.remove();
  }, [query]);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7 + i);
    return d;
  });
  const tasks = today.data?.tasks ?? [];
  const selectedTasks = tasks.filter((t) => {
    const w = taskWindow(t);
    return w
      ? sameDay(new Date(w.start), selected)
      : t.dueAt
        ? sameDay(new Date(t.dueAt), selected)
        : false;
  });
  const overdue = tasks.filter(
    (t) =>
      t.status !== "completed" &&
      t.dueAt &&
      Date.parse(t.dueAt) < Date.now() &&
      !selectedTasks.some((s) => s.id === t.id),
  );
  const nextTask = tasks.find((task) => task.status === "pending");
  return (
    <MainNavigation title="Today & goals" active="today">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={today.isRefetching}
            onRefresh={() => void today.refetch()}
          />
        }
      >
        <Text style={styles.title}>Your day, at a glance</Text>
        <Text style={styles.muted}>
          {new Date().toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </Text>
        <ErrorMessage error={today.error} />
        {today.isLoading && (
          <ActivityIndicator accessibilityLabel="Loading goals and tasks" />
        )}
        {today.isError && (
          <Button
            title="Retry loading"
            secondary
            onPress={() => void today.refetch()}
          />
        )}
        {today.data && (
          <>
            {checkin && (
              <VoiceCheckin
                key={checkin.id}
                checkin={checkin}
                onClose={() => {
                  setCheckin(null);
                  void today.refetch();
                }}
              />
            )}
            <ErrorMessage error={checkinError} />
            {checkinError && (
              <Button
                title="Retry goal check-in"
                secondary
                onPress={() => void openCheckin()}
              />
            )}
            <View style={styles.row}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Button
                  title="Open chat"
                  onPress={() => router.navigate("/companion")}
                />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Button
                  title="Missions"
                  secondary
                  onPress={() => router.navigate("/missions")}
                />
              </View>
            </View>
            {nextTask && (
              <View style={styles.section}>
                <Text style={styles.heading}>Your next step</Text>
                <TaskRow
                  task={nextTask}
                  goal={today.data.goals.find((g) => g.id === nextTask.goalId)}
                />
              </View>
            )}
            <View style={styles.section}>
              <Text style={styles.heading}>Your goals</Text>
              {!today.data.goals.length && (
                <Text style={styles.body}>
                  What would you like to make progress on? Share a goal, then
                  let AI suggest manageable steps.
                </Text>
              )}
              {today.data.goals.map((goal) => (
                <View
                  key={goal.id}
                  style={{
                    gap: 12,
                    padding: 18,
                    backgroundColor: colors.soft,
                    borderRadius: 16,
                    marginBottom: 10,
                  }}
                >
                  <Text style={[styles.body, { fontWeight: "600" }]}>
                    {goal.title}
                  </Text>
                  {goal.motivation && (
                    <Text style={styles.muted}>{goal.motivation}</Text>
                  )}
                  <Button
                    title="Plan this goal with AI"
                    secondary
                    onPress={() => setPlanning(goal)}
                  />
                  <Button
                    title="Suggest a mission"
                    secondary
                    onPress={() =>
                      router.push({
                        pathname: "/missions",
                        params: { goalId: goal.id },
                      })
                    }
                  />
                </View>
              ))}
              {!goalForm && (
                <Button
                  title="Share a goal"
                  onPress={() => setGoalForm(true)}
                />
              )}
              {goalForm && (
                <View style={{ gap: 14 }}>
                  <Field
                    label="What is your goal?"
                    value={title}
                    onChangeText={setTitle}
                    maxLength={180}
                    editable={!addGoal.isPending}
                    placeholder="Learn enough Spanish for my trip"
                  />
                  <Field
                    label="Why it matters (optional)"
                    value={motivation}
                    onChangeText={setMotivation}
                    maxLength={1200}
                    multiline
                    editable={!addGoal.isPending}
                  />
                  <ErrorMessage error={addGoal.error} />
                  <Button
                    title={addGoal.isPending ? "Saving goal…" : "Save goal"}
                    disabled={addGoal.isPending || !title.trim()}
                    onPress={() => addGoal.mutate()}
                  />
                  <Button
                    title="Cancel"
                    secondary
                    disabled={addGoal.isPending}
                    onPress={() => setGoalForm(false)}
                  />
                </View>
              )}
              {planning && (
                <PlanBuilder
                  key={planning.id}
                  goal={planning}
                  onClose={() => setPlanning(null)}
                />
              )}
            </View>
            {today.data.proposals.map((p) => (
              <PlanReview key={p.id} proposal={p} existingTasks={tasks} />
            ))}
            <View style={styles.section}>
              <Text style={styles.heading}>Your calendar</Text>
              <Text style={styles.muted}>
                In-app schedule ·{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </Text>
              <View style={styles.row}>
                <Button
                  title="Previous week"
                  secondary
                  onPress={() => {
                    setWeekOffset((n) => n - 1);
                    setSelected((old) => {
                      const d = new Date(old);
                      d.setDate(d.getDate() - 7);
                      return d;
                    });
                  }}
                />
                <Button
                  title="Next week"
                  secondary
                  onPress={() => {
                    setWeekOffset((n) => n + 1);
                    setSelected((old) => {
                      const d = new Date(old);
                      d.setDate(d.getDate() + 7);
                      return d;
                    });
                  }}
                />
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {days.map((day) => {
                  const chosen = sameDay(day, selected);
                  const total = tasks.filter((t) => {
                    const w = taskWindow(t);
                    return w && sameDay(new Date(w.start), day);
                  }).length;
                  return (
                    <Pressable
                      key={day.toDateString()}
                      accessibilityRole="button"
                      accessibilityLabel={`${day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}, ${total} tasks`}
                      accessibilityState={{ selected: chosen }}
                      onPress={() => setSelected(day)}
                      style={{
                        minWidth: 66,
                        minHeight: 96,
                        borderRadius: 12,
                        padding: 12,
                        gap: 6,
                        alignItems: "center",
                        backgroundColor: chosen
                          ? colors.accent
                          : colors.secondary,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          color: chosen ? colors.onAccent : colors.ink,
                        }}
                      >
                        {day.toLocaleDateString([], { weekday: "short" })}
                      </Text>
                      <Text
                        style={{
                          fontSize: 22,
                          fontWeight: "600",
                          color: chosen ? colors.onAccent : colors.ink,
                        }}
                      >
                        {day.getDate()}
                      </Text>
                      <Text
                        style={{
                          fontSize: 13,
                          color: chosen ? colors.onAccent : colors.ink,
                        }}
                      >
                        {total} tasks
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Text style={styles.body}>
                {selected.toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </Text>
              {!selectedTasks.length && (
                <Text style={styles.muted}>
                  No tasks scheduled for this day. Create a goal plan to fill
                  your calendar.
                </Text>
              )}
              {selectedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  goal={today.data.goals.find((g) => g.id === task.goalId)}
                />
              ))}
            </View>
            {!!overdue.length && (
              <View style={styles.section}>
                <Text style={styles.heading}>Needs attention</Text>
                <Text style={styles.muted}>
                  These tasks are past their scheduled time. Complete them when
                  you’re ready.
                </Text>
                {overdue.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    goal={today.data.goals.find((g) => g.id === task.goalId)}
                  />
                ))}
              </View>
            )}
            <View style={styles.section}>
              <View style={styles.row}>
                <Text style={[styles.body, { flex: 1 }]}>
                  Voice goal check-ins
                </Text>
                <Switch
                  accessibilityLabel="Voice goal check-ins"
                  value={today.data.checkinsEnabled}
                  disabled={preferences.isPending}
                  onValueChange={(value) => {
                    if (!value) {
                      enabled.current = false;
                      setCheckin(null);
                    }
                    preferences.mutate(value);
                  }}
                  trackColor={{ true: colors.accent }}
                />
              </View>
              <Text style={styles.muted}>
                On app open, ask about a goal if you skipped a check-in or have
                overdue tasks. At most once every 24 hours. Answers use voice;
                you can always choose “Not now”.
              </Text>
              <ErrorMessage error={preferences.error} />
              <Button
                title="Private encrypted chat"
                secondary
                onPress={() => router.push("/encrypted-chat")}
              />
            </View>
          </>
        )}
      </ScrollView>
    </MainNavigation>
  );
}
