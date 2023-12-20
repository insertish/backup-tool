import { fetchBlueprints, fetchHosts, findLastRun } from "./mongodb.js";
import { Blueprint, Host } from "./planner.js";

export const HOSTS: Record<string, Host> = await fetchHosts();
export const BLUEPRINTS: Blueprint[] = await fetchBlueprints();
export const LATEST_RUNS: Record<string, Date> = {};

for (const blueprint of BLUEPRINTS) {
  LATEST_RUNS[blueprint._id] = await findLastRun(blueprint._id);
}
