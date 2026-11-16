import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { todaySchema, type Goal } from "../shared/contracts";
import {
  createMissionSchema,
  missionDefinitionSchema,
  missionDetailSchema,
  missionInputSchema,
  missionsPageSchema,
  type MissionSuggestion,
  type MissionDefinition,
} from "../shared/missions";
import { api, newId } from "./client";
import { useSession } from "./auth";
import { Button, colors, ErrorMessage, Field, styles } from "./ui";

const textFileSchema = z.object({ name: z.string(), content: z.string() });
const presets = [
  { title: "Daily at 9 am", cron: "0 9 * * *" },
  { title: "Weekdays at 9 am", cron: "0 9 * * 1-5" },
  { title: "Mondays at 9 am", cron: "0 9 * * 1" },
];
function dateLabel(value: string, timezone?: string) {
  return new Date(value).toLocaleString([], {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function MissionForm({
  userId,
  goals,
  suggestion,
  initialGoalId,
  runnerAvailable,
  onClose,
  onSaved,
}: {
  userId: string;
  goals: Goal[];
  suggestion: MissionSuggestion | null;
  initialGoalId: string;
  runnerAvailable: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [id] = useState(newId);
  const [draft, setDraft] = useState<MissionDefinition>(() => ({
    goalId: suggestion?.goalId ?? initialGoalId,
    title: suggestion?.title ?? "",
    instructions: suggestion?.instructions ?? "",
    kind: suggestion?.kind ?? "review",
    cron: suggestion?.cron ?? presets[0].cron,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    folder: suggestion?.folder ?? "goal-review",
  }));
  const [advanced, setAdvanced] = useState(false);
  const [approved, setApproved] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const scheduleKey = `${draft.cron}|${draft.timezone}`;
  function update<K extends keyof MissionDefinition>(
    key: K,
    value: MissionDefinition[K],
  ) {
    setDraft((old) => ({ ...old, [key]: value }));
    setApproved(false);
  }
  const preview = useMutation({
    mutationFn: async (schedule: { cron: string; timezone: string }) => ({
      key: `${schedule.cron}|${schedule.timezone}`,
      ...z
        .object({
          nextRuns: z.array(z.string().datetime({ offset: true })).length(3),
        })
        .parse(
          await api("/missions/preview", "POST", schedule, undefined, userId),
        ),
    }),
  });
  const previewValid = preview.data?.key === scheduleKey;
  const valid = missionDefinitionSchema.safeParse(draft).success;
  const save = useMutation({
    mutationFn: () =>
      api(
        "/missions",
        "POST",
        createMissionSchema.parse({
          ...draft,
          id,
          enabled: enabled && runnerAvailable,
          approved: true,
        }),
        undefined,
        userId,
      ),
    onSuccess: () => onSaved(id),
  });
  return (
    <View style={styles.inset}>
      <Text style={styles.heading}>Shape your mission</Text>
      <Text style={styles.muted}>
        A recurring document to help you move a goal forward. Review its
        instructions and schedule before you approve.
      </Text>
      <Text style={styles.label}>Goal</Text>
      {goals.map((goal) => (
        <Button
          key={goal.id}
          title={`${draft.goalId === goal.id ? "Selected: " : ""}${goal.title}`}
          secondary={draft.goalId !== goal.id}
          disabled={save.isPending}
          onPress={() => update("goalId", goal.id)}
        />
      ))}
      <Field
        label="Mission name"
        value={draft.title}
        maxLength={120}
        editable={!save.isPending}
        onChangeText={(v) => update("title", v)}
        placeholder="My weekly goal review"
      />
      <Field
        label="What should it prepare?"
        value={draft.instructions}
        maxLength={2000}
        multiline
        editable={!save.isPending}
        onChangeText={(v) => update("instructions", v)}
        placeholder="Review my goal and tasks, then write a short progress review and a practical next step."
      />
      <Text style={styles.label}>Document type</Text>
      <View style={styles.row}>
        {(["practice", "briefing", "review"] as const).map((kind) => (
          <Button
            key={kind}
            title={kind[0].toUpperCase() + kind.slice(1)}
            secondary={draft.kind !== kind}
            disabled={save.isPending}
            onPress={() => update("kind", kind)}
          />
        ))}
      </View>
      <Text style={styles.label}>Schedule</Text>
      {presets.map((preset) => (
        <Button
          key={preset.cron}
          title={preset.title}
          secondary={draft.cron !== preset.cron}
          disabled={save.isPending || preview.isPending}
          onPress={() => update("cron", preset.cron)}
        />
      ))}
      <Field
        label="Timezone"
        value={draft.timezone}
        autoCapitalize="none"
        maxLength={80}
        editable={!save.isPending && !preview.isPending}
        onChangeText={(v) => update("timezone", v)}
        placeholder="Europe/London"
      />
      <Button
        title={advanced ? "Hide advanced schedule" : "Advanced schedule"}
        secondary
        disabled={save.isPending}
        onPress={() => setAdvanced(!advanced)}
      />
      {advanced && (
        <>
          <Field
            label="Five-field cron schedule"
            value={draft.cron}
            autoCapitalize="none"
            maxLength={100}
            editable={!save.isPending && !preview.isPending}
            onChangeText={(v) => update("cron", v)}
          />
          <Text style={styles.muted}>
            Minute · hour · day of month · month · weekday. For example, 0 9 * *
            1 runs Mondays at 9 am in your timezone.
          </Text>
        </>
      )}
      <Button
        title={preview.isPending ? "Checking schedule…" : "Preview next 3 runs"}
        secondary
        disabled={
          save.isPending ||
          preview.isPending ||
          !draft.cron.trim() ||
          !draft.timezone.trim()
        }
        onPress={() =>
          preview.mutate({ cron: draft.cron, timezone: draft.timezone })
        }
      />
      <ErrorMessage error={preview.error} />
      {previewValid && (
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Next runs · {draft.timezone}</Text>
          {preview.data?.nextRuns.map((run) => (
            <Text key={run} style={styles.body}>
              {dateLabel(run, draft.timezone)}
            </Text>
          ))}
        </View>
      )}
      <Field
        label="Private folder name"
        value={draft.folder}
        maxLength={48}
        autoCapitalize="none"
        editable={!save.isPending}
        onChangeText={(v) => update("folder", v)}
      />
      <Text style={styles.muted}>
        Use lowercase letters, numbers, and hyphens. This mission reads input
        files and saves generated documents only in its own private folder.
      </Text>
      {!runnerAvailable && (
        <Text style={styles.muted}>
          Mission runner unavailable. You can save a paused mission; activation
          and Run now will be available when it is connected.
        </Text>
      )}
      <View style={styles.row}>
        <Text style={[styles.body, { flex: 1 }]}>
          Start running on this schedule
        </Text>
        <Switch
          accessibilityLabel="Start running on this schedule"
          value={enabled && runnerAvailable}
          disabled={!runnerAvailable || save.isPending}
          trackColor={{ true: colors.accent }}
          onValueChange={setEnabled}
        />
      </View>
      <Text style={styles.body}>
        This mission can read this goal/tasks and files in its folder and save
        generated documents. It runs until paused.
      </Text>
      {!previewValid && (
        <Text style={styles.muted}>
          Preview the schedule before approving this mission.
        </Text>
      )}
      <View style={styles.row}>
        <Text style={[styles.body, { flex: 1 }]}>
          I approve this recurring mission
        </Text>
        <Switch
          accessibilityLabel="I approve this recurring mission"
          value={approved}
          disabled={!previewValid || save.isPending}
          trackColor={{ true: colors.accent }}
          onValueChange={setApproved}
        />
      </View>
      {!valid && (
        <Text style={styles.muted}>
          Choose a goal, a name of at least 3 characters, instructions of at
          least 10 characters, and a valid private folder name.
        </Text>
      )}
      <ErrorMessage error={save.error} />
      <Button
        title={
          save.isPending
            ? "Saving mission…"
            : enabled && runnerAvailable
              ? "Save and activate mission"
              : "Save paused mission"
        }
        disabled={save.isPending || !valid || !previewValid || !approved}
        onPress={() => save.mutate()}
      />
      <Button
        title="Cancel"
        secondary
        disabled={save.isPending}
        onPress={onClose}
      />
    </View>
  );
}
function MissionDetail({
  id,
  userId,
  runnerAvailable,
  onClose,
}: {
  id: string;
  userId: string;
  runnerAvailable: boolean;
  onClose: () => void;
}) {
  const query = useQueryClient();
  const key = ["mission", userId, id];
  const detail = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      missionDetailSchema.parse(
        await api(`/missions/${id}`, "GET", undefined, signal, userId),
      ),
    refetchInterval: (q) =>
      q.state.data?.runs.some(
        (r) => r.status === "queued" || r.status === "running",
      )
        ? 8000
        : false,
  });
  const [name, setName] = useState("notes.md");
  const [content, setContent] = useState("");
  const [opened, setOpened] = useState<z.infer<typeof textFileSchema> | null>(
    null,
  );
  const refresh = async () => {
    await Promise.all([
      query.invalidateQueries({ queryKey: key }),
      query.invalidateQueries({ queryKey: ["missions", userId] }),
    ]);
  };
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api(`/missions/${id}`, "PATCH", { enabled }, undefined, userId),
    onSuccess: refresh,
  });
  const [requestId, setRequestId] = useState(newId);
  const run = useMutation({
    mutationFn: () =>
      api(`/missions/${id}/run`, "POST", { requestId }, undefined, userId),
    onSuccess: async () => {
      setRequestId(newId());
      await refresh();
    },
  });
  const file = useMutation({
    mutationFn: () =>
      api(
        `/missions/${id}/files`,
        "POST",
        missionInputSchema.parse({ name, content }),
        undefined,
        userId,
      ),
    onSuccess: refresh,
  });
  const read = useMutation({
    mutationFn: async (path: string) =>
      textFileSchema.parse(
        await api(path, "GET", undefined, undefined, userId),
      ),
    onSuccess: setOpened,
  });
  return (
    <View style={styles.inset}>
      <Button title="Close mission" secondary onPress={onClose} />
      {detail.isLoading && (
        <ActivityIndicator accessibilityLabel="Loading mission" />
      )}
      <ErrorMessage error={detail.error} />
      {detail.isError && (
        <Button
          title="Retry mission"
          secondary
          onPress={() => void detail.refetch()}
        />
      )}
      {detail.data && (
        <>
          <Text style={styles.heading}>{detail.data.mission.title}</Text>
          <Text style={styles.body}>
            {detail.data.mission.status === "active" ? "Active" : "Paused"}
            {detail.data.mission.nextRunAt
              ? ` · Next: ${dateLabel(detail.data.mission.nextRunAt, detail.data.mission.timezone)}`
              : ""}
          </Text>
          <Text style={styles.muted}>
            {detail.data.mission.cron} · {detail.data.mission.timezone}
          </Text>
          <Text style={styles.body}>{detail.data.mission.instructions}</Text>
          <Text style={styles.label}>Private folder</Text>
          <Text selectable style={styles.muted}>
            {detail.data.storagePath}
          </Text>
          {!runnerAvailable && (
            <Text style={styles.muted}>
              Mission runner unavailable. Activation and Run now are unavailable
              until it is connected.
            </Text>
          )}
          <Button
            title={
              toggle.isPending
                ? "Saving…"
                : detail.data.mission.status === "active"
                  ? "Pause mission"
                  : "Activate mission"
            }
            secondary
            disabled={
              toggle.isPending ||
              (!runnerAvailable && detail.data.mission.status !== "active")
            }
            onPress={() =>
              toggle.mutate(detail.data.mission.status !== "active")
            }
          />
          <Button
            title={
              run.isPending
                ? "Queuing…"
                : detail.data.mission.status !== "active"
                  ? "Activate first to run"
                  : "Run now"
            }
            disabled={
              !runnerAvailable ||
              detail.data.mission.status !== "active" ||
              run.isPending ||
              detail.data.runs.some(
                (r) => r.status === "queued" || r.status === "running",
              )
            }
            onPress={() => run.mutate()}
          />
          <ErrorMessage error={toggle.error || run.error} />
          {run.isSuccess && (
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              Run queued. Its status will update below.
            </Text>
          )}
          <View style={styles.section}>
            <Text style={styles.heading}>Input files</Text>
            <Text style={styles.muted}>
              Add a short text file for this mission to use. Saving an existing
              name replaces its contents. You can save up to 10 input files.
              Each run reads only the first 4 files alphabetically and the first
              4,000 characters of each. Put your most useful context first.
            </Text>
            {!detail.data.storageAvailable && (
              <Text style={styles.muted}>
                Private file storage is unavailable. Try again when storage is
                connected.
              </Text>
            )}
            {!detail.data.files.length && (
              <Text style={styles.muted}>No input files yet.</Text>
            )}
            {detail.data.files.map((entry) => (
              <Button
                key={entry.name}
                title={`Read ${entry.name}`}
                secondary
                disabled={read.isPending || !detail.data?.storageAvailable}
                onPress={() => {
                  setOpened(null);
                  read.mutate(
                    `/missions/${id}/files?name=${encodeURIComponent(entry.name)}`,
                  );
                }}
              />
            ))}
            <Field
              label="File name (.txt, .md, or .json)"
              value={name}
              onChangeText={(value) => {
                setName(value);
                file.reset();
              }}
              maxLength={61}
              autoCapitalize="none"
              editable={!file.isPending}
            />
            <Field
              label="File contents"
              value={content}
              onChangeText={(value) => {
                setContent(value);
                file.reset();
              }}
              maxLength={16000}
              multiline
              editable={!file.isPending}
            />
            <Button
              title={file.isPending ? "Saving file…" : "Save input file"}
              secondary
              disabled={
                !detail.data.storageAvailable ||
                file.isPending ||
                !missionInputSchema.safeParse({ name, content }).success
              }
              onPress={() => file.mutate()}
            />
            <ErrorMessage error={file.error} />
            {file.isSuccess && (
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                Input file saved.
              </Text>
            )}
          </View>
          <View style={styles.section}>
            <Text style={styles.heading}>Recent runs</Text>
            {!detail.data.runs.length && (
              <Text style={styles.muted}>
                No runs yet. Activate the schedule, then choose Run now when the
                runner is available.
              </Text>
            )}
            {detail.data.runs.map((entry) => (
              <View key={entry.id} style={styles.section}>
                <Text style={styles.label}>
                  {
                    {
                      queued: "Queued",
                      running: "Preparing document",
                      succeeded: "Document ready",
                      failed: "Could not finish",
                      cancelled: "Cancelled",
                    }[entry.status]
                  }
                </Text>
                <Text style={styles.muted}>
                  {dateLabel(entry.scheduledFor, detail.data?.mission.timezone)}
                </Text>
                {entry.summary && (
                  <Text style={styles.body}>{entry.summary}</Text>
                )}
                {entry.error && <Text style={styles.error}>{entry.error}</Text>}
                {entry.artifact && (
                  <Button
                    title="Read generated document"
                    secondary
                    disabled={read.isPending || !detail.data?.storageAvailable}
                    onPress={() => {
                      setOpened(null);
                      read.mutate(`/missions/${id}/runs/${entry.id}/artifact`);
                    }}
                  />
                )}
              </View>
            ))}
          </View>
        </>
      )}
      {read.isPending && (
        <ActivityIndicator accessibilityLabel="Reading document" />
      )}
      <ErrorMessage error={read.error} />
      {opened && (
        <View style={styles.section}>
          <Text style={styles.heading}>{opened.name}</Text>
          <Text selectable style={styles.body}>
            {opened.content}
          </Text>
          {detail.data?.files.some((entry) => entry.name === opened.name) && (
            <Button
              title="Edit input file"
              secondary
              disabled={file.isPending}
              onPress={() => {
                setName(opened.name);
                setContent(opened.content);
                file.reset();
                setOpened(null);
              }}
            />
          )}
          <Button
            title="Close document"
            secondary
            onPress={() => setOpened(null)}
          />
        </View>
      )}
    </View>
  );
}
function MissionsScreen({ userId }: { userId: string }) {
  const params = useLocalSearchParams<{ goalId?: string | string[] }>();
  const goalFilter =
    typeof params.goalId === "string" ? params.goalId : undefined;
  const query = useQueryClient();
  const page = useQuery({
    queryKey: ["missions", userId],
    queryFn: async ({ signal }) =>
      missionsPageSchema.parse(
        await api("/missions", "GET", undefined, signal, userId),
      ),
  });
  const goals = useQuery({
    queryKey: ["mission-goals", userId],
    queryFn: async ({ signal }) =>
      todaySchema.parse(await api("/today", "GET", undefined, signal, userId))
        .goals,
  });
  const [form, setForm] = useState<{
    suggestion: MissionSuggestion | null;
    key: string;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const suggestions =
    page.data?.suggestions.filter(
      (s) => !goalFilter || s.goalId === goalFilter,
    ) ?? [];
  return (
    <ScrollView
      key={form?.key ?? selected ?? "mission-list"}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={page.isRefetching || goals.isRefetching}
          onRefresh={() => {
            void page.refetch();
            void goals.refetch();
          }}
        />
      }
    >
      <Button
        title="Back to Today"
        secondary
        onPress={() => router.replace("/")}
      />
      <Text style={styles.title}>Missions</Text>
      <Text style={styles.body}>
        Give a goal a little ongoing support. A mission prepares a useful
        document on a schedule you choose.
      </Text>
      {(page.isLoading || goals.isLoading) && (
        <ActivityIndicator accessibilityLabel="Loading missions and goals" />
      )}
      <ErrorMessage error={page.error || goals.error} />
      {(page.isError || goals.isError) && (
        <Button
          title="Retry loading"
          secondary
          onPress={() => {
            void page.refetch();
            void goals.refetch();
          }}
        />
      )}
      {page.data && goals.data && (
        <>
          {!page.data.runnerAvailable && (
            <Text style={styles.muted}>
              Mission runner unavailable. You can prepare and save paused
              missions now.
            </Text>
          )}
          {selected ? (
            <MissionDetail
              key={selected}
              id={selected}
              userId={userId}
              runnerAvailable={page.data.runnerAvailable}
              onClose={() => setSelected(null)}
            />
          ) : form ? (
            <MissionForm
              key={form.key}
              userId={userId}
              goals={goals.data}
              suggestion={form.suggestion}
              initialGoalId={
                goals.data.find((g) => g.id === goalFilter)?.id ?? ""
              }
              runnerAvailable={page.data.runnerAvailable}
              onClose={() => setForm(null)}
              onSaved={(id) => {
                setForm(null);
                setSelected(id);
                void query.invalidateQueries({
                  queryKey: ["missions", userId],
                });
              }}
            />
          ) : (
            <>
              {!goals.data.length ? (
                <Text style={styles.body}>
                  Share a goal on Today to get mission suggestions that fit what
                  matters to you.
                </Text>
              ) : (
                <>
                  <View style={styles.section}>
                    <Text style={styles.heading}>
                      {goalFilter
                        ? "Ideas for this goal"
                        : "Suggested from your goals"}
                    </Text>
                    {!suggestions.length && (
                      <Text style={styles.muted}>
                        No suggestions for this goal yet. You can create your
                        own mission below.
                      </Text>
                    )}
                    {suggestions.map((suggestion, index) => (
                      <View
                        key={`${suggestion.goalId}-${index}`}
                        style={styles.section}
                      >
                        <Text style={styles.label}>
                          {goals.data.find((g) => g.id === suggestion.goalId)
                            ?.title ?? "Your goal"}
                        </Text>
                        <Text style={[styles.body, { fontWeight: "600" }]}>
                          {suggestion.title}
                        </Text>
                        <Text style={styles.muted}>{suggestion.reason}</Text>
                        <Text style={styles.body}>
                          {suggestion.instructions}
                        </Text>
                        <Button
                          title="Use this suggestion"
                          secondary
                          onPress={() => {
                            setSelected(null);
                            setForm({ suggestion, key: newId() });
                          }}
                        />
                      </View>
                    ))}
                    <Button
                      title="Create your own mission"
                      secondary
                      onPress={() => {
                        setSelected(null);
                        setForm({ suggestion: null, key: newId() });
                      }}
                    />
                  </View>
                </>
              )}
              <View style={styles.section}>
                <Text style={styles.heading}>Your missions</Text>
                {!page.data.missions.length && (
                  <Text style={styles.muted}>
                    Your approved missions will appear here. Every mission
                    starts with your review.
                  </Text>
                )}
                {page.data.missions.map((mission) => (
                  <View key={mission.id} style={styles.section}>
                    <Text style={[styles.body, { fontWeight: "600" }]}>
                      {mission.title}
                    </Text>
                    <Text style={styles.muted}>
                      {mission.status === "active" ? "Active" : "Paused"} ·{" "}
                      {goals.data.find((g) => g.id === mission.goalId)?.title ??
                        "Goal"}
                    </Text>
                    {mission.nextRunAt && (
                      <Text style={styles.muted}>
                        Next: {dateLabel(mission.nextRunAt, mission.timezone)} ·{" "}
                        {mission.timezone}
                      </Text>
                    )}
                    <Button
                      title="Open mission"
                      secondary
                      onPress={() => {
                        setForm(null);
                        setSelected(mission.id);
                      }}
                    />
                  </View>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
export default function Missions() {
  const session = useSession();
  return session ? (
    <MissionsScreen key={session.user.id} userId={session.user.id} />
  ) : null;
}
