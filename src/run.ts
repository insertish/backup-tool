import { BLUEPRINTS, HOSTS, LATEST_RUNS } from "./data.js";
import { createPlan } from "./planner.js";
import { execute } from "./executor.js";
import colors from "@colors/colors";
import yesno from "yesno";
import { saveRun } from "./mongodb.js";
import dayjs from "dayjs";

const AGENT = process.env.AGENT as string;

const plans = [];

for (const blueprint of BLUEPRINTS) {
  const plan = createPlan(HOSTS, blueprint, LATEST_RUNS[blueprint._id], AGENT);
  if (plan.mode !== "skipped" && plan.mode !== "failed") plans.push(plan);

  console.log();
}

if (!plans.length) process.exit(0);

if (
  await yesno({
    question: `I will execute ${plans.length} plans, continue [y/n]?`,
  })
) {
  console.log();

  let i = 0;
  for (const plan of plans) {
    console.info(colors.gray(`{ ${++i} / ${plans.length} }`));

    let error;
    const log: string[] = [];
    try {
      const start = dayjs();
      const eT = () => dayjs.duration(dayjs().diff(start)).asSeconds();
      await execute(HOSTS[AGENT], plan, (s) => {
        log.push(s);
        console.info(`[${eT()}s] ${s}`);
      });
    } catch (err) {
      error = "" + err;
      console.error(err);
    }

    await saveRun(plan, log, error);
  }
}

process.exit(0);
