#! /usr/bin/env node

// liskov-semver: A SemVer checker using Liskov's Substitution Principle.
// Copyright (C) 2024  La Crypta
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

"use strict";

import child_process from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import semver from "semver";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// ----------------------------------------------------------------------------------------------------------------------------------------
// -- OS ----------------------------------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------------------------------------

function prefixAll(lines, prefix) {
  return (
    lines
      .trim()
      .split("\n")
      .map((line) => `${prefix} ${line}`)
      .join("\n") + "\n"
  );
}

async function spawn(command, args, options) {
  return new Promise((resolve, _reject) => {
    let stdout = "";
    let stderr = "";
    const boundary = `${command} ${args.map((arg) => `[${arg}]`).join(" ")}\n`;
    process.stderr.write(`[START] ${boundary}`);
    try {
      const child = child_process.spawn(command, args, options);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data) => (stdout += data.toString()));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data) => (stderr += data.toString()));
      child.on("close", (code) => {
        process.stderr.write(prefixAll(stdout, "[OUT]"));
        process.stderr.write(prefixAll(stderr, "[ERR]"));
        process.stderr.write(`[CODE] ${code}\n`);
        process.stderr.write(`[DONE] ${boundary}`);
        resolve({ code, stdout, stderr });
      });
    } catch (e) {
      process.stderr.write(prefixAll(stdout, "[OUT]"));
      process.stderr.write(prefixAll(stderr, "[ERR]"));
      process.stderr.write(`[CODE] ${code}`);
      process.stderr.write(`[DONE] ${boundary}`);
      resolve({ code: e.code, stdout, stderr });
    }
  });
}

async function exists(path) {
  return fs.promises.access(path, fs.constants.F_OK).then(
    () => true,
    () => false
  );
}

async function withTempDir(prefix, callback) {
  let tempDir = null;
  try {
    tempDir = await fs.promises.mkdtemp(prefix);
    return await callback(tempDir);
  } finally {
    if (null !== tempDir) {
      await fs.promises.rm(tempDir, {
        force: true,
        recursive: true,
        maxRetries: 5,
      });
    }
  }
}

// ----------------------------------------------------------------------------------------------------------------------------------------
// -- Git ---------------------------------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------------------------------------

async function getRoot() {
  const { code, stdout } = await spawn("git", ["rev-parse", "--show-toplevel"]);
  return 0 === code ? stdout.trim() : null;
}

async function isDirty(root) {
  const { code, stdout } = await spawn("git", ["status", "--porcelain"], {
    cwd: root,
  });
  return !(0 === code && "" === stdout.trim());
}

async function isReachable(root, oldRef, newRef) {
  const { code, stdout } = await spawn(
    "git",
    ["rev-list", "--boundary", `${oldRef}..${newRef}`],
    { cwd: root }
  );
  return 0 === code && "" !== stdout.trim();
}

async function getHighestVersionTag(root) {
  const { code, stdout } = await spawn("git", ["tag", "--list"], {
    cwd: root,
  });
  let tags =
    0 === code
      ? stdout.split("\n").filter((tag) => null !== semver.valid(tag))
      : [];
  tags.sort(semver.rcompare);
  return tags[0] ?? null;
}

async function getCurrentBranch(root) {
  const { code, stdout } = await spawn("git", ["branch", "--show-current"], {
    cwd: root,
  });
  return 0 === code ? stdout.trim() : null;
}

async function getRefCommit(root, ref, refType) {
  const { code, stdout } = await spawn(
    "git",
    ["rev-list", "-1", `${refType}s/${ref}`],
    {
      cwd: root,
    }
  );
  return 0 === code ? stdout.trim() : null;
}

async function cloneTo(root, to, ref) {
  const { code } = await spawn("git", [
    "clone",
    "--branch",
    ref,
    "-c",
    "advice.detachedHead=false",
    "--depth",
    "1",
    "--single-branch",
    "--no-tags",
    "--recurse-submodules",
    "--shallow-submodules",
    "--",
    `file://${root}`,
    to,
  ]);
  return 0 === code;
}

// ----------------------------------------------------------------------------------------------------------------------------------------
// -- *PM ---------------------------------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------------------------------------

async function pm(dir) {
  if (await exists(path.join(dir, "yarn.lock"))) {
    return "yarn";
  } else if (await exists(path.join(dir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  return "npm";
}

async function pm_install(dir) {
  const command = await pm(dir);
  const args = {
    yarn: ["install", "--production"],
    pnpm: ["install", "--prod"],
    npm: ["install", "--production"],
  };
  const { code } = await spawn(command, args[command], { cwd: dir });
  return 0 === code;
}

async function pm_rename(dir, name) {
  const { code } = await spawn("npm", ["pkg", "set", `name=${name}`], {
    cwd: dir,
  });
  return 0 === code;
}

async function pm_build(dir) {
  const command = await pm(dir);
  switch (command) {
    case "yarn":
      const packageJsonContents = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"))
      );
      if (typeof packageJsonContents !== "object") {
        throw new Error("error: malformed package.json");
      }
      if (
        typeof packageJsonContents.scripts === "object" &&
        undefined !== packageJsonContents.scripts.build
      ) {
        const { code } = await spawn("yarn", ["run", "build"], { cwd: dir });
        return 0 === code;
      }
      return true;
    case "pnpm":
    case "npm":
      const { code } = await spawn(command, ["run", "--if-present", "build"], {
        cwd: dir,
      });
      return 0 === code;
  }
}

async function pm_packTo(dir, to) {
  const command = await pm(dir);
  let packed = null;
  switch (command) {
    case "yarn":
      const { code: yarnPackCode } = await spawn("yarn", ["pack"], {
        cwd: dir,
      });
      if (0 !== yarnPackCode) {
        return false;
      }
      packed = "package.tgz";
      break;
    case "pnpm":
    case "npm":
      const { code: npmPnpmPackCode, stdout: npmPnpmPackStdout } = await spawn(
        command,
        ["pack"],
        {
          cwd: dir,
        }
      );
      if (0 !== npmPnpmPackCode) {
        return false;
      }
      packed = npmPnpmPackStdout.trim();
      break;
  }
  const { code } = await spawn("mv", [path.resolve(dir, packed), to]);
  return 0 === code;
}

// ----------------------------------------------------------------------------------------------------------------------------------------
// -- SemVer ------------------------------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------------------------------------

function latest(leftSemVer, rightSemVer) {
  let semVers = [leftSemVer, rightSemVer];
  semVers.sort(semver.rcompare);
  return semVers[0];
}

// ----------------------------------------------------------------------------------------------------------------------------------------
// -- Main --------------------------------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------------------------------------

async function createTgzAndGetEntryPointsAndVersion(root, base, ref, name) {
  const dir = path.join(base, name);

  await fs.promises.mkdir(dir);

  if (!(await cloneTo(root, dir, ref))) {
    throw new Error("error: failed to clone to temporary directory");
  }

  const packageJsonPath = path.join(dir, "package.json");
  if (!(await exists(packageJsonPath))) {
    throw new Error("error: no package.json found after cloning");
  }

  if (!(await pm_rename(dir, name))) {
    throw new Error("error: failed to rename");
  }
  if (!(await pm_install(dir))) {
    throw new Error("error: failed to install");
  }
  if (!(await pm_build(dir))) {
    throw new Error("error: failed to build");
  }
  if (!(await pm_packTo(dir, path.join(base, `${name}.tgz`)))) {
    throw new Error("error: failed to pack");
  }

  const packageJsonContents = JSON.parse(fs.readFileSync(packageJsonPath));
  if (typeof packageJsonContents !== "object") {
    throw new Error("error: malformed package.json");
  }

  let entryPoints = [];
  if ("types" in packageJsonContents) {
    entryPoints.push("");
  }
  entryPoints = entryPoints.concat(
    Object.entries(packageJsonContents.exports ?? {})
      .filter(([_key, value]) => typeof value === "object" && "types" in value)
      .map(([key, _value]) => key)
  );
  entryPoints.sort();

  return [entryPoints, packageJsonContents.version ?? null];
}

async function hydrateBaseDirectoryAndGetSemver(
  root,
  previousVersion,
  currentVersion,
  base
) {
  const [
    [previousVersionEndpoints, previousSemVer],
    [currentVersionEndpoints, currentSemVer],
  ] = await Promise.all([
    await createTgzAndGetEntryPointsAndVersion(
      root,
      base,
      previousVersion,
      "previousVersion"
    ),
    await createTgzAndGetEntryPointsAndVersion(
      root,
      base,
      currentVersion,
      "currentVersion"
    ),
  ]);

  const commonSource = [
    '"use strict";',
    "",
    previousVersionEndpoints
      .map((entryPoint) =>
        "" === entryPoint
          ? `import * as previousVersion_ from "previousVersion";`
          : `import * as previousVersion_${entryPoint} from "previousVersion/${entryPoint}";`
      )
      .join("\n"),
    "",
    currentVersionEndpoints
      .map((entryPoint) =>
        "" === entryPoint
          ? `import * as currentVersion_ from "currentVersion";`
          : `import * as currentVersion_${entryPoint} from "currentVersion/${entryPoint}";`
      )
      .join("\n"),
    "",
    `const previousVersion = { ${previousVersionEndpoints
      .map((entryPoint) => `_${entryPoint}: previousVersion_${entryPoint}`)
      .join(", ")} };`,
    `const currentVersion = { ${currentVersionEndpoints
      .map((entryPoint) => `_${entryPoint}: currentVersion_${entryPoint}`)
      .join(", ")} };`,
    "",
  ].join("\n");

  await Promise.all([
    fs.promises.writeFile(
      path.join(base, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            previousVersion: "./previousVersion.tgz",
            currentVersion: "./currentVersion.tgz",
          },
        },
        null,
        2
      )
    ),
    fs.promises.writeFile(
      path.join(base, "currentFitsPrevious.ts"),
      [
        commonSource,
        "((_: typeof previousVersion): void => void {})(currentVersion);",
        "",
      ].join("\n")
    ),
    fs.promises.writeFile(
      path.join(base, "previousFitsCurrent.ts"),
      [
        commonSource,
        "((_: typeof currentVersion): void => void {})(previousVersion);",
        "",
      ].join("\n")
    ),
  ]);

  if (!(await pm_install(base))) {
    throw new Error("error: failed to install");
  }

  return [previousSemVer, currentSemVer];
}

async function tscOk(base, file) {
  const ts = path.join(base, file);
  const { code } = await spawn("tsc", ["--noEmit", "--strict", ts], {
    cwd: base,
  });
  return 0 === code;
}

async function liskovSemVerForwardsBackwards(
  root,
  previousVersion,
  currentVersion
) {
  return withTempDir(path.join(os.tmpdir(), "liskov-semver-"), async (base) => {
    const [previousSemVer, currentSemVer] =
      await hydrateBaseDirectoryAndGetSemver(
        root,
        previousVersion,
        currentVersion,
        base
      );
    const [currentFitsPrevious, previousFitsCurrent] = await Promise.all([
      tscOk(base, "currentFitsPrevious.ts"),
      tscOk(base, "previousFitsCurrent.ts"),
    ]);
    return [
      previousSemVer,
      currentSemVer,
      currentFitsPrevious,
      previousFitsCurrent,
    ];
  });
}

async function main(errorOnDirty, errorOnUnreachable) {
  const root = await getRoot(".");
  if (null === root) {
    throw new Error("error: cannot determine git root");
  }

  if (errorOnDirty && (await isDirty(root))) {
    throw new Error("error: dirty working tree");
  }

  const previousVersion = await getHighestVersionTag(root);
  if (null === previousVersion) {
    return "0.1.0";
  }
  const previousVersionHash = await getRefCommit(root, previousVersion, "tag");
  if (null === previousVersionHash) {
    throw new Error(
      `error: cannot determine commit for previous version (${previousVersion})`
    );
  }

  const currentVersion = await getCurrentBranch(root);
  if (null === currentVersion) {
    throw new Error("error: no current version --- detached HEAD?");
  }
  const currentVersionHash = await getRefCommit(root, currentVersion, "head");
  if (null === currentVersionHash) {
    throw new Error(
      `error: cannot determine commit for current version (${currentVersion})`
    );
  }

  if (previousVersionHash === currentVersionHash) {
    return semver.valid(previousVersion);
  }

  if (
    errorOnUnreachable &&
    !(await isReachable(root, previousVersion, currentVersion))
  ) {
    throw new Error(
      "error: current version is not reachable from previous version"
    );
  }

  const [previousSemVer, currentSemVer, forwards, backwards] =
    await liskovSemVerForwardsBackwards(root, previousVersion, currentVersion);

  let newSemVer = "0.1.0";
  if (forwards) {
    if (backwards) {
      // patch
      newSemVer = semver.inc(previousSemVer, "patch");
    } else {
      // minor
      newSemVer = semver.inc(previousSemVer, "minor");
    }
  } else if (0 === semver.major(previousSemVer)) {
    // minor
    newSemVer = semver.inc(previousSemVer, "minor");
  } else {
    // major
    newSemVer = semver.inc(previousSemVer, "major");
  }

  return latest(newSemVer, semver.parse(currentSemVer));
}

// ----------------------------------------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------------------------------------

const argv = await yargs(hideBin(process.argv))
  .wrap(process.stdout.columns)
  .scriptName("liskov-semver")
  .env("LISKOV_SEMVER")
  .help("h")
  .alias("h", "?")
  .alias("h", "help")
  .parserConfiguration({
    "camel-case-expansion": true,
    "dot-notation": false,
    "parse-numbers": false,
    "parse-positional-numbers": false,
    "combine-arrays": true,
    "greedy-arrays": false,
    "nargs-eats-options": true,
    "set-placeholder-key": true,
    "strip-aliased": true,
    "strip-dashed": true,
    "unknown-options-as-args": true,
  })
  .option("error-on-dirty", {
    boolean: true,
    default: true,
    description: "Show error if the working directory is not clean",
    global: true,
  })
  .option("error-on-unreachable", {
    boolean: true,
    default: true,
    description:
      "Show error if the latest semver tag cannot reach the current branch",
    global: true,
  })
  .epilog(
    'Boolean options have "opposites" starting with a "--no-" prefix, eg. "--no-error-on-dirty".'
  )
  .epilog("")
  .epilog("Copyright (C) 2024  La Crypta")
  .epilog(
    "Released under the AGPLv3+ License <https://www.gnu.org/licenses/agpl-3.0.html>"
  )
  .parse();

try {
  process.stdout.write(
    `${await main(argv.errorOnDirty, argv.errorOnUnreachable)}\n`
  );
  process.exit(0);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
