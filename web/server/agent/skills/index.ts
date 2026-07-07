// Skill registry — port of the Python prototype's SKILL.md pattern, adapted
// for a bundled serverless runtime: skills are TS modules (bundler-safe, no
// filesystem reads on Vercel) instead of markdown files on disk.
//
// Each skill contributes:
// - `content`: always-loaded routing instructions, injected into the system
//   prompt inside an <available_skills> block, and
// - `references`: on-demand detail the agent fetches with the read_reference
//   tool — progressive disclosure that keeps the base prompt lean.

import { hikingSafetySkill } from "./hiking-safety";
import { trailSearchSkill } from "./trail-search";
import { tripEditingSkill } from "./trip-editing";
import { tripPlanningSkill } from "./trip-planning";

export interface Skill {
  name: string;
  content: string;
  references?: Record<string, string>;
}

export const SKILLS: Skill[] = [
  trailSearchSkill,
  tripPlanningSkill,
  tripEditingSkill,
  hikingSafetySkill,
];

/** The <available_skills> block for the system prompt. */
export function buildSkillsBlock(): string {
  const blocks = SKILLS.map(
    (s) => `<skill name="${s.name}">\n${s.content.trim()}\n</skill>`,
  );
  return `<available_skills>\n${blocks.join("\n")}\n</available_skills>`;
}

/** Every readable reference path, as "skill-name/reference-name". */
export function listReferences(): string[] {
  return SKILLS.flatMap((s) =>
    Object.keys(s.references ?? {}).map((ref) => `${s.name}/${ref}`),
  );
}

/** Resolve a "skill-name/reference-name" path. Null when unknown. */
export function getReference(path: string): string | null {
  const [skillName, ...rest] = path.trim().split("/");
  const refName = rest.join("/");
  const skill = SKILLS.find((s) => s.name === skillName);
  const ref = skill?.references?.[refName];
  return ref ? ref.trim() : null;
}
