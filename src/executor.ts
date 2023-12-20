import dayjs from "dayjs";
import { Host, Plan } from "./planner.js";
import colors from "@colors/colors";

import duration from "dayjs/plugin/duration.js";
import { SSHExecutor, createSSHExecutor } from "./executorHelpers.js";
import { resolve } from "path";
import { rm } from "fs/promises";
dayjs.extend(duration);

export async function execute(
  hosts: Record<string, Host>,
  agentId: string,
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
  const executor = createSSHExecutor(
    hosts[agentId]!.ssh[plan.host._id]
  ) as SSHExecutor;
  await executor.ready();

  log(`Executor ready, running the strategy`);
  const pkgFn = await executor.execute(plan);

  const {
    downloadLocally,
    retainOnHost,
    directlyCloneTo,
    redirectCloneTo,
    receiveCloneFrom,
  } = plan.clone;

  const backupName = `${plan.id.replace(
    /\//g,
    "-"
  )}_${new Date().toISOString()}.tar.gz`;

  for (const host of directlyCloneTo) {
    log(`Uploading the backup to ${colors.gray(host.host)}`);
    await executor.scpUpload(
      pkgFn,
      hosts[plan.host._id].ssh[host.host],
      host.path + backupName
    );
  }

  for (const host of receiveCloneFrom) {
    log(`Downloading the backup to ${colors.gray(host.host)}`);
    const downloadExecutor = createSSHExecutor(
      hosts[agentId].ssh[host.host]
    ) as SSHExecutor;
    await downloadExecutor.ready();
    await downloadExecutor.scpDownload(
      pkgFn,
      hosts[host.host].ssh[plan.host._id],
      host.path + backupName
    );
    await downloadExecutor.finish();
  }

  if (downloadLocally) {
    const localFile = resolve(`./backups/${backupName}`);

    log(`Downloading the backup to the agent`);
    await executor.download(pkgFn, localFile);

    for (const host of redirectCloneTo) {
      switch (host.type) {
        case "host":
          log(`Uploading the local backup to ${colors.gray(host.host)}`);
          const uploadExecutor = createSSHExecutor(
            hosts[agentId].ssh[host.host]
          );
          await uploadExecutor.ready();
          await uploadExecutor.upload(localFile, host.path + backupName);
          await uploadExecutor.finish();
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
