import colors, { blue } from "@colors/colors";
import dayjs from "dayjs";

import relativeTime from "dayjs/plugin/relativeTime.js";
dayjs.extend(relativeTime);

type BackupStrategy =
  | {
      type: "files";
      paths: string[];
    }
  | {
      type: "mongodb";
      connectionUrl: string;
    };

type Destination = {
  type: "host";
  host: string;

  /**
   * Path to folder or leading path for the file
   *
   * e.g. /backups/ or /path/to/backup_
   */
  path: string;
};

export type Hook = {
  cwd: string;
  cmd: string;
};

export type Hooks = {
  pre?: Hook;
  post?: Hook;
};

export type Blueprint = {
  _id: string;
  interval: "daily" | "weekly" | "monthly";
} & (
  | {
      mode: "ssh-agent";
      host: string;
      hooks?: Hooks;
      strategy: BackupStrategy;
      destinations: Destination[];
    }
  | {
      mode: "dummy";
    }
);

export type CloneStrategy = {
  /**
   * Whether to retain the backup on the host
   */
  retainOnHost:
    | {
        path: string;
      }
    | false;

  /**
   * Whether to save a copy of the backup locally
   *
   * Will always be true if we must redirect clones through agent
   */
  downloadLocally:
    | {
        path: string;
      }
    | boolean;

  /**
   * Destinations we can clone to direct from the host
   */
  directlyCloneTo: Destination[];

  /**
   * Destinations we must upload to from the agent
   */
  redirectCloneTo: Destination[];

  /**
   * Destinations we can receive the clone direct from the host
   * (as in, we can connect to the destination and download it there)
   */
  receiveCloneFrom: Destination[];
};

export type Plan = {
  id: string;
} & (
  | {
      mode: "ssh-agent";
      host: Host;
      hooks?: Hooks;
      strategy: BackupStrategy;
      clone: CloneStrategy;
    }
  | {
      mode: "skipped";
    }
  | {
      mode: "failed";
    }
);

/**
 * Create a new backup plan
 * @param hosts Hosts
 * @param blueprint Blueprint
 * @param latestRun Latest run
 * @param agent Agent
 * @returns Backup plan
 */
export function createPlan(
  hosts: Record<string, Host>,
  blueprint: Blueprint,
  latestRun: Date | undefined,
  agent: string
): Plan {
  console.info(
    `${colors.bgWhite(" ")} Preparing plan for ${colors.gray(blueprint._id)}`
  );

  // Check if we are due another backup
  console.debug(
    `${colors.bgWhite(" ")} Backup interval is ${colors.gray(
      blueprint.interval
    )}`
  );

  if (latestRun) {
    console.debug(
      `${colors.bgWhite(" ")} Last backed up ${colors.gray(
        dayjs(latestRun).fromNow()
      )}`
    );

    switch (blueprint.interval) {
      case "daily":
        latestRun.setDate(latestRun.getDate() + 1);
        break;
      case "weekly":
        latestRun.setDate(latestRun.getDate() + 7);
        break;
      case "monthly":
        latestRun.setMonth(latestRun.getMonth() + 1);
        break;
    }

    if (+latestRun > +new Date()) {
      console.debug(`${colors.bgBrightCyan(" ")} Skipping this time...`);
      return {
        id: blueprint._id,
        mode: "skipped",
      };
    }
  }

  try {
    if (blueprint.mode === "dummy") {
      return {
        id: blueprint._id,
        mode: "skipped",
      };
    } else {
      const host = hosts[blueprint.host];
      if (!host) throw `Host ${colors.gray(blueprint.host)} does not exist!`;
      if (!host.available) throw "Host is unavailable!";

      if (!hosts[agent])
        throw `Agent host ${colors.gray(agent)} does not exist!`;
      if (typeof hosts[agent].ssh[blueprint.host] === "undefined")
        throw `Host ${colors.gray(
          blueprint.host
        )} is unreachable from this agent!`;

      const destinationHost = blueprint.destinations.find(
        (destination) =>
          destination.type === "host" && destination.host === blueprint.host
      );

      const agentHost = blueprint.destinations.find(
        (destination) =>
          destination.type === "host" && destination.host === agent
      );

      if (destinationHost) {
        console.info(
          `${colors.bgBrightGreen(" ")} Result will be stored on the host`
        );
      }

      if (agentHost) {
        console.info(
          `${colors.bgBrightGreen(" ")} Result will be downloaded locally`
        );
      }

      let oneOrMoreHostsFailed = false;

      const destinations = blueprint.destinations.filter((destination) => {
        if (destination.type === "host") {
          if (destination.host === agent || destination.host === host._id)
            return false;

          const destinationHost = hosts[destination.host];
          if (!destinationHost || destinationHost.available === "unreachable") {
            console.info(
              `${colors.bgBrightRed(" ")} Host ${colors.gray(
                destination.host
              )} is unreachable from agent`
            );

            oneOrMoreHostsFailed = true;

            return false;
          }

          return true;
        } else {
          throw "unimplemented";
        }
      });

      const clone: CloneStrategy = {
        retainOnHost: destinationHost ? { path: destinationHost.path } : false,
        downloadLocally: agentHost ? { path: agentHost.path } : false,

        directlyCloneTo: destinations.filter((destination) => {
          if (typeof host.ssh[destination.host] === "undefined") return false;

          console.info(
            `${colors.bgBrightGreen(
              " "
            )} It will be uploaded directly to host ${colors.gray(
              destination.host
            )}`
          );

          return true;
        }),
        redirectCloneTo: destinations.filter((destination) => {
          if (
            typeof host.ssh[destination.host] !== "undefined" ||
            typeof hosts[destination.host]?.ssh[host._id] !== "undefined"
          )
            return false;

          console.info(
            `${colors.bgBrightGreen(
              " "
            )} It will be uploaded through the agent to host ${colors.gray(
              destination.host
            )}`
          );

          return true;
        }),
        receiveCloneFrom: destinations.filter((destination) => {
          if (
            typeof host.ssh[destination.host] !== "undefined" ||
            typeof hosts[destination.host]?.ssh[host._id] === "undefined"
          )
            return false;

          console.info(
            `${colors.bgBrightGreen(
              " "
            )} It will be downloaded on the host ${colors.gray(
              destination.host
            )} directly`
          );

          return true;
        }),
      };

      // Error out if we have no destinations
      if (
        !clone.redirectCloneTo.length &&
        !clone.directlyCloneTo.length &&
        !clone.retainOnHost &&
        !clone.downloadLocally
      )
        throw "no viable destinations";

      if (oneOrMoreHostsFailed)
        console.info(
          `${colors.bgBrightYellow(" ")} ${colors.yellow(
            "WARN: will skip some destinations"
          )}`
        );

      // Make sure we download it anyways if we are redirecting
      if (clone.redirectCloneTo.length && !clone.downloadLocally)
        clone.downloadLocally = true;

      return {
        id: blueprint._id,
        mode: "ssh-agent",
        hooks: blueprint.hooks,
        host: hosts[blueprint.host],
        clone,
        strategy: blueprint.strategy,
      };
    }
  } catch (err) {
    console.info(`${colors.bgBrightRed(" ")} ${colors.red(`ERR: ${err}`)}`);

    return {
      id: blueprint._id,
      mode: "failed",
    };
  }
}

export type Host = {
  /**
   * Unique id of this host
   */
  _id: string;

  /**
   * Whether this is the agent's host
   */
  agent?: boolean;

  /**
   * Whether the host is alive / reachable
   *
   * If the agent can't check, this will equal 'no-data'
   */
  available?: "reachable" | "unreachable" | "no-data";

  /**
   * How this host can connect to other known hosts
   */
  ssh: {
    [key: string]: {
      username: string;
      host: string;
      privateKeyPath: string;
      passphrase?: string;
    };
  };
};
