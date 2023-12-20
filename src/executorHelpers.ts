import { Config as SSHConfig, NodeSSH } from "node-ssh";
import { Host, Plan } from "./planner.js";

export function tmp(ext = ".tar.gz") {
  return `/tmp/backup${Math.random().toString().substring(2)}${ext}`;
}

export abstract class Executor {
  abstract ready(): Promise<void>;
  abstract finish(): Promise<void>;
  abstract execute(plan: Plan): Promise<string>;
  abstract download(remoteFile: string, localFile: string): Promise<void>;
  abstract move(src: string, dest: string): Promise<void>;
  abstract delete(remoteFile: string): Promise<void>;
}

export class LocalExecutor extends Executor {
  async ready() {}
  async finish() {}

  async execute(plan: Plan): Promise<string> {
    throw new Error("Method not implemented.");
  }

  async download(remoteFile: string, localFile: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async move(src: string, dest: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async delete(remoteFile: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
}

export class SSHExecutor extends Executor {
  config: SSHConfig;
  ssh: NodeSSH;

  constructor(config: SSHConfig) {
    super();
    this.config = config;
    this.ssh = new NodeSSH();
  }

  async ready() {
    await this.ssh.connect(this.config);
  }

  async finish() {
    await this.ssh.dispose();
  }

  async execute(plan: Plan & { mode: "ssh-agent" }): Promise<string> {
    const pkgFn = tmp();

    if (plan.hooks?.pre) {
      await this.ssh.execCommand(plan.hooks.pre.cmd, {
        cwd: plan.hooks.pre.cwd,
      });
    }

    switch (plan.strategy.type) {
      case "files":
        await this.ssh.exec("tar", ["czvfP", pkgFn, ...plan.strategy.paths]);
        break;
      case "mongodb":
        const fn = `/tmp/mongodump_${new Date().toISOString()}`;

        try {
          await this.ssh.exec("mongodump", [
            "-o",
            fn,
            plan.strategy.connectionUrl,
          ]);
        } catch (err: any) {
          if (("" + err).toString().includes("Failed")) {
            throw err;
          }
        }

        await this.ssh.exec("tar", ["czvfP", pkgFn, fn]);
        await this.ssh.exec("rm", ["-r", fn]);
        break;
    }

    if (plan.hooks?.post) {
      await this.ssh.execCommand(plan.hooks.post.cmd, {
        cwd: plan.hooks.post.cwd,
      });
    }

    return pkgFn;
  }

  async move(src: string, dest: string): Promise<void> {
    await this.ssh.exec("mv", [src, dest]);
  }

  async download(remoteFile: string, localFile: string): Promise<void> {
    await this.ssh.getFile(localFile, remoteFile);
  }

  async delete(pkgFn: string): Promise<void> {
    await this.ssh.exec("rm", [pkgFn]);
  }
}

export function createSSHExecutor(config: SSHConfig): Executor {
  /*switch (host.type) {
    case "local":
      return new LocalExecutor();
    case "ssh":*/
  return new SSHExecutor(config);
  //}
}
