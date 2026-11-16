import type { MissionSuggestion } from "../shared/missions";
export function missionSuggestions(
  goals: { id: string; title: string }[],
): MissionSuggestion[] {
  return goals.slice(0, 6).flatMap((goal) => {
    const learning =
      /learn|study|exam|language|spanish|french|code|coding|interview|practice|course|math/i.test(
        goal.title,
      );
    const label = goal.title.slice(0, 75);
    return [
      {
        goalId: goal.id,
        title: learning
          ? `Daily practice: ${label}`
          : `Daily briefing: ${label}`,
        kind: learning ? ("practice" as const) : ("briefing" as const),
        instructions: learning
          ? `Prepare a small practice pack for my goal: ${goal.title}. Use materials I place in the mission folder. Include one worked example, three practice prompts, and suggested answers. If the topic is unclear, identify the missing information rather than inventing course content.`
          : `Prepare a concise next-step briefing for my goal: ${goal.title}. Use my recorded task status and files in this mission folder. Explain one useful next step and any missing information. Do not claim tasks are complete without a recorded outcome.`,
        reason: learning
          ? "A small, ready-to-use practice pack makes the next study session easier to start."
          : "A prepared briefing can help you choose a concrete next step before you open the app.",
        cron: "0 9 * * *",
        folder: "daily-preparation",
      },
      {
        goalId: goal.id,
        title: `Weekly review: ${label}`,
        kind: "review" as const,
        instructions: `Review recorded progress toward my goal: ${goal.title}. Summarize completed and pending tasks, use the mission folder as supporting material, and suggest one realistic adjustment. Distinguish recorded outcomes from guesses. Do not modify my tasks or calendar.`,
        reason:
          "A weekly review uses actual task outcomes to help you adjust your plan.",
        cron: "0 9 * * 1",
        folder: "weekly-review",
      },
    ];
  });
}
export function missionFolder(
  ownerId: string,
  missionId: string,
  folder: string,
): string {
  const idPattern =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (
    !idPattern.test(ownerId) ||
    !idPattern.test(missionId) ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/.test(folder)
  )
    throw new Error("Invalid mission storage scope");
  return `${ownerId}/missions/${missionId}/${folder}`;
}
export function missionInputName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,55}\.(txt|md|json)$/.test(name))
    throw new Error(
      "Use a simple .txt, .md, or .json filename without folders.",
    );
  return name;
}
