import { getScenario as load } from "@aporia/scenario";
export function getScenario(id: string, version?: string) {
  return load(id, version);
}
