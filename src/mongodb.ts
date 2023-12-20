import { MongoClient } from "mongodb";
import { Blueprint, Host, Plan } from "./planner.js";
import { NodeSSH } from "node-ssh";

const client = new MongoClient(process.env.MONGODB as string);
const db = client.db((process.env.DATABASE as string) ?? "backups");
const agent = process.env.AGENT as string;

export async function fetchHosts() {
  const hosts: Record<string, Host> = {};
  const results = await db.collection<Host>("hosts").find().toArray();

  for (const host of results) {
    if (host._id === agent) {
      host.agent = true;
    }

    hosts[host._id] = host;
  }

  const agentHost = hosts[agent];
  if (agentHost) {
    for (const hostId of Object.keys(agentHost.ssh)) {
      if (!hosts[hostId]) continue;

      const sshConfig = agentHost.ssh[hostId];

      try {
        const ssh = new NodeSSH();
        ssh.connect(sshConfig);
        ssh.dispose();

        hosts[hostId].available = "reachable";
      } catch (err) {
        hosts[hostId].available = "unreachable";
      }
    }
  }

  return hosts;
}

export async function fetchBlueprints() {
  return await db.collection<Blueprint>("blueprints").find().toArray();
}

export async function saveRun(plan: Plan, log: string[], error?: string) {
  await db.collection("run_log").insertOne({
    timestamp: new Date(),
    plan,
    log,
    error,
  });
}

export async function findLastRun(planId: string) {
  const lastRun = await db.collection("run_log").findOne(
    {
      $and: [
        {
          "plan.id": planId,
        },
        {
          $or: [
            {
              error: { $exists: 0 },
            },
            {
              error: null,
            },
          ],
        },
      ],
    },
    {
      sort: {
        timestamp: -1,
      },
    }
  );

  return lastRun?.timestamp;
}
