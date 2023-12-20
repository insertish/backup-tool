import dayjs from "dayjs";
import { Host, Plan } from "./planner.js";
import colors from "@colors/colors";

import duration from "dayjs/plugin/duration.js";
import { createSSHExecutor } from "./executorHelpers.js";
import { resolve } from "path";
import { rm } from "fs/promises";
dayjs.extend(duration);

export async function execute(
  agent: Host | undefined,
  plan: Plan,
  log: (s: string) => void
) {
  if (plan.mode !== "ssh-agent") {
    log(
      `Skipping plan ${colors.gray(plan.id)} as it is ${colors.gray(plan.mode)}`
    );
    return;
  }

  log(`Preparing to run plan for ${colors.gray(plan.id)}`);
  const executor = createSSHExecutor(agent!.ssh[plan.host._id]);
  await executor.ready();

  log(`Executor ready, running the strategy`);
  const pkgFn = await executor.execute(plan);

  const { downloadLocally, retainOnHost, directlyCloneTo, redirectCloneTo } =
    plan.clone;

  const backupName = `${plan.id.replace(
    /\//g,
    "-"
  )}_${new Date().toISOString()}.tar.gz`;

  for (const host of directlyCloneTo) {
    // TODO: upload the backup
  }

  if (downloadLocally) {
    const localFile = `./backups/${backupName}`;

    log(`Downloading the backup to the agent`);
    await executor.download(pkgFn, resolve(localFile));

    for (const host of redirectCloneTo) {
      switch (host.type) {
        case "host":
          log(`Uploading the backup to ${colors.gray(host.host)}`);
          // TODO: upload the backup
          break;
      }
    }

    if (typeof downloadLocally === "object") {
      // Retain backup locally
      // TODO: actually consider the path parameter
    } else {
      log(`Removing local copy of backup`);
      await rm(localFile);
    }
  }

  if (retainOnHost) {
    log(`Retaining backup on the remote host`);
    await executor.move(pkgFn, retainOnHost.path + backupName);
  } else {
    log(`Removing backup from remote host`);
    await executor.delete(pkgFn);
  }

  await executor.finish();
  log(`Plan complete`);
}
