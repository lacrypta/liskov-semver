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

/**
 * Apply the given prefix to all given lines.
 *
 * @param {string[]} lines - The lines to prefix.
 * @param {string} prefix - Te prefix to apply.
 * @returns {string} The resulting `string`.
 */
function prefixAll(lines, prefix) {
  return (
    lines
      .trim()
      .split("\n")
      .map((line) => `${prefix} ${line}`)
      .join("\n") + "\n"
  );
}

/**
 * Wrapper around {@linkcode child_process.spawn} that returns everything neatly.
 *
 * @param {string} command - Command to execute.
 * @param {string[] | undefined} args - Arguments to pass to the given command.
 * @param {child_process.SpawnOptionsWithoutStdio | undefined} options - Options to pass on to {@linkcode child_process.spawn}.
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} A {@linkcode Promise} that resolves to an `object` with the exist status, standard output, and standard error strings.
 */
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

/**
 * Determine whether the given path exists or not.
 *
 * @param {string} path - Path to check the existence of.
 * @returns {Promise<boolean>} Resolves with `true` if the given path exists, `false` otherwise.
 */
async function exists(path) {
  return fs.promises.access(path, fs.constants.F_OK).then(
    () => true,
    () => false
  );
}

/**
 * A callback for the {@linkcode withTempDir} function.
 *
 * @callback withTempDirCallback
 * @param {string} tempDir - The temporary directory created.
 * @returns {*} Whatever the callback returns.
 */

/**
 * Create a new temporary directory under the given prefix, and call the given callback on it.
 *
 * This function will create a temporary directory on the given directory prefix, and call the given callback with the created directory's path as argument.
 * Once the callback finishes, the temporary directory is deleted.
 *
 * @param {string} prefix - The prefix under which to create the temporary directory.
 * @param {withTempDirCallback} callback - The callback to execute.
 * @returns {Promise<*>} Resolves to whatever the callback returns.
 */
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

/**
 * Return the git root of the current directory, or `null` if none found.
 *
 * @returns {Promise<string | null>} Resolves to the git root dir, or `null` if none found.
 */
async function getRoot() {
  const { code, stdout } = await spawn("git", ["rev-parse", "--show-toplevel"]);
  return 0 === code ? stdout.trim() : null;
}

/**
 * Determine whether the given git root is dirty or not.
 *
 * @param {string} root - The git root to query.
 * @returns {Promise<boolean>} Resolves to `true` if the given got root is dirty, `false` otherwise.
 */
async function isDirty(root) {
  const { code, stdout } = await spawn("git", ["status", "--porcelain"], {
    cwd: root,
  });
  return !(0 === code && "" === stdout.trim());
}

/**
 * Retrieve the largest amongst all the tags that look as semver `string`s.
 *
 * @param {string} root - The git root to query.
 * @returns {Promise<string | null>} Resolves to the tag that looks like the highest semver `string`, or `null` if none found.
 */
async function getHighestVersionTag(root) {
  const { code, stdout } = await spawn("git", ["tag", "--merged"], {
    cwd: root,
  });
  let tags =
    0 === code
      ? stdout.split("\n").filter((tag) => null !== semver.valid(tag))
      : [];
  tags.sort(semver.rcompare);
  return tags[0] ?? null;
}

/**
 * Retrieve the current git branch.
 *
 * @param {string} root - The git root to query.
 * @returns {Promise<string | null>} Resolves to the current branch name, or `null` if none found.
 */
async function getCurrentBranch(root) {
  const { code, stdout } = await spawn("git", ["branch", "--show-current"], {
    cwd: root,
  });
  return 0 === code ? stdout.trim() : null;
}

/**
 * Retrieve the commit hash of the given git reference.
 *
 * @param {string} root - The git root to query.
 * @param {string} ref - The reference name to look for.
 * @param {string} refType - The reference type to look for (eg. "tag").
 * @returns {Promise<string | null>} Resolves to the commit hash, or `null` if none found.
 */
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

/**
 * Shallowly clone the given local repository on the given git reference only.
 *
 * @param {string} root - The git root to use.
 * @param {string} to - The directory onto which to clone to.
 * @param {string} ref - The git reference to clone.
 * @returns {Promise<boolean>} Resolves with `true` if cloning was successful, `false` otherwise.
 */
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

/**
 * Detect the package manager in use on the given directory.
 *
 * @param {string} dir - Directory containing the `package.json` file.
 * @returns {Promise<"yarn" | "pnpm" | "npm">} Resolves with the detected package manager, defaulting to `"npm"` if no package manager found.
 */
async function pm(dir) {
  if (await exists(path.join(dir, "yarn.lock"))) {
    return "yarn";
  } else if (await exists(path.join(dir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  return "npm";
}

/**
 * Install the package dependencies on the given directory.
 *
 * This function will either run:
 *
 * - `yarn install --production` if the detected package manager is `yarn`,
 * - `pnpm install --prod` if the detected package manager is `pnpm`, or
 * - `npm install --production` if the detected package manager is `npm` (default).
 *
 * @param {string} dir - The directory containing the `package.json` file.
 * @returns {Promise<boolean>} Resolves to `true` if install was successful, `false` otherwise.
 */
async function pm_install(dir, production) {
  const command = await pm(dir);
  const args = {
    yarn: ["install", "--non-interactive"].concat(
      production ? ["--production"] : []
    ),
    pnpm: ["install", "--frozen-lockfile"].concat(production ? ["--prod"] : []),
    npm: ["install", "--no-fund", "--no-audit"].concat(
      production ? ["--production"] : []
    ),
  };
  const { code } = await spawn(command, args[command], { cwd: dir });
  return 0 === code;
}

/**
 * Rename the package in the given directory.
 *
 * This function will simply run `npm pkg set name=NAME`, it does not depend on the detected package manager.
 *
 * @param {string} dir - The directory containing the `package.json` file.
 * @param {string} name - The new name to use.
 * @returns {Promise<boolean>} Resolves to `true` if the rename was successful, `false` otherwise.
 */
async function pm_rename(dir, name) {
  const { code } = await spawn("npm", ["pkg", "set", `name=${name}`], {
    cwd: dir,
  });
  return 0 === code;
}

/**
 * Build the package in the given directory.
 *
 * This function will either run:
 *
 * - `yarn run build` if the detected package manager is `yarn` (and a `build` script indeed exists),
 * - `pnpm run --if-present build` if the detected package manager is `pnpm`, or
 * - `npm run --if-present build` if the detected package manager is `npm` (default).
 *
 * @param {string} dir - The directory containing the `package.json` file.
 * @returns {Promise<boolean>} Resolves to `true` if build was successful, `false` otherwise.
 */
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

/**
 * Pack the package unu the given directory and rename the package to the given destination path.
 *
 * This function will either run:
 *
 * - `yarn pack` and move `package.tgz` if the detected package manager is `yarn`,
 * - `pnpm pack` and move the resulting file if the detected package manager is `pnpm`, or
 * - `npm pack` and move the resulting file  if the detected package manager is `npm` (default).
 *
 * @param {string} dir - The directory containing the `package.json` file.
 * @param {string} to - THe directory to copy the generated pack into.
 * @returns {Promise<boolean>} Resolves to `true` if pack generation and moving was successful, `false` otherwise.
 */
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

/**
 * Determine the greatest between two semver `string`s.
 *
 * @param {string} leftSemVer - The first semver to compare.
 * @param {string} rightSemVer - The second semver to compare.
 * @returns {string} The greatest of the two given semvers.
 */
function latest(leftSemVer, rightSemVer) {
  let semVers = [leftSemVer, rightSemVer];
  semVers.sort(semver.rcompare);
  return semVers[0];
}

// ----------------------------------------------------------------------------------------------------------------------------------------
// -- Main --------------------------------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------------------------------------

/**
 * Clone the given git reference from the given git root, rename it, install its dependencies, build it, and pack it into the given base directory.
 *
 * @param {string} root - The git root to use (where `package.json` is located).
 * @param {string} ref - The git reference to create a packed dependency for.
 * @param {string} base - The directory unto which to write the working files.
 * @param {string} name - The name to use for the created dependency.
 * @returns {Promise<undefined>} Resolves with `undefined` if dependency creation was successful.
 */
async function createTgzDependency(root, ref, base, name) {
  const dir = path.join(base, name);

  await fs.promises.mkdir(dir);

  if (!(await cloneTo(root, dir, ref))) {
    throw new Error("error: failed to clone to temporary directory");
  }
  if (!(await pm_rename(dir, name))) {
    throw new Error("error: failed to rename");
  }
  if (!(await pm_install(dir, false))) {
    throw new Error("error: failed to install");
  }
  if (!(await pm_build(dir))) {
    throw new Error("error: failed to build");
  }
  if (!(await pm_packTo(dir, path.join(base, `${name}.tgz`)))) {
    throw new Error("error: failed to pack");
  }
}

/**
 * Scan the directory containing a `package.json` file to extract TypeScript entry points and determine the package version.
 *
 * @param {string} dir - The directory where the `package.json` file resides.
 * @returns {[string[], string | null]} A pair consisting of the entry points array, and the detected version (or `null` if none detected).
 */
function extractEntryPointsAndVersion(dir) {
  const packageJsonContents = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"))
  );
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

  return [entryPoints, semver.valid(packageJsonContents.version ?? null)];
}

/**
 * Crete the version witnesses from the given git root, and "previous" and "current" references, using the given temporary directory.
 *
 * Creating the version witnesses implies:
 *
 * 1. creating each individual version's packed dependencies,
 * 2. creating the witness `package.json` file,
 * 3. creating the witnesses proper, and
 * 4. installing the witness project itself.
 *
 * @param {string} root - The git root to use.
 * @param {string} previousVersion - The "previous version" git reference to use.
 * @param {string} currentVersion - The "current version" git reference to use.
 * @param {string} base - The temporary directory into which to create the version witnesses.
 * @returns {Promise<[string, string, string, string]>} Resolves with a 4-tuple of the "previous" semver, "current" semver, "backwards" witness, and "forwards" witness.
 */
async function createVersionWitnesses(
  root,
  previousVersion,
  currentVersion,
  base
) {
  await Promise.all([
    await createTgzDependency(root, previousVersion, base, "previousVersion"),
    await createTgzDependency(root, currentVersion, base, "currentVersion"),
  ]);

  const [previousEndpoints, previousSemVer] = extractEntryPointsAndVersion(
    path.join(base, "previousVersion")
  );
  const [currentEndpoints, currentSemVer] = extractEntryPointsAndVersion(
    path.join(base, "currentVersion")
  );

  const commonSource = [
    '"use strict";',
    "",
    previousEndpoints
      .map(
        (entryPoint) =>
          `import * as previousVersion_${entryPoint} from "previousVersion${
            "" === entryPoint ? "" : "/"
          }${entryPoint}";`
      )
      .join("\n"),
    "",
    currentEndpoints
      .map(
        (entryPoint) =>
          `import * as currentVersion_${entryPoint} from "currentVersion${
            "" === entryPoint ? "" : "/"
          }${entryPoint}";`
      )
      .join("\n"),
    "",
    `const previousVersion = { ${previousEndpoints
      .map((entryPoint) => `_${entryPoint}: previousVersion_${entryPoint}`)
      .join(", ")} };`,
    `const currentVersion = { ${currentEndpoints
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
            typescript: "next",
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

  if (!(await pm_install(base, true))) {
    throw new Error("error: failed to install");
  }

  return [
    previousSemVer,
    currentSemVer,
    "currentFitsPrevious.ts",
    "previousFitsCurrent.ts",
  ];
}

/**
 * Test the given file in the given directory to see whether `tsc` finds errors within it.
 *
 * @param {string} base - Temporary directory where the files to test are stored.
 * @param {string} file - Base name of the file to test.
 * @returns {Promise<boolean>} Resolves with `true` if the `tsc` compiler finds no problems with the tested file, `false` otherwise.
 */
async function tscOk(base, file) {
  const ts = path.join(base, file);
  const { code } = await spawn("tsc", ["--noEmit", "--strict", ts], {
    cwd: base,
  });
  return 0 === code;
}

/**
 * Run the complete Liskov checking procedure from the given git root for the given "previous" and "current" version references.
 *
 * Running the complete Liskov checking procedure entails creating the version witnesses (via {@linkcode createVersionWitnesses}), and running `tsc` on each witness.
 *
 * @param {string} root - The git root to use.
 * @param {string} previousVersion - The "previous" git reference to use.
 * @param {string} currentVersion - The "current" git reference to use.
 * @returns {Promise<string, string, boolean, boolean>} Resolves with a 4-tuple of the "previous" semver, "current" semver, "backwards" witness result, and "forwards" witness result.
 */
async function liskovSemVerForwardsBackwards(
  root,
  previousVersion,
  currentVersion
) {
  return withTempDir(path.join(os.tmpdir(), "liskov-semver-"), async (base) => {
    const [
      previousSemVer,
      currentSemVer,
      currentFitsPreviousTs,
      previousFitsCurrentTs,
    ] = await createVersionWitnesses(
      root,
      previousVersion,
      currentVersion,
      base
    );
    const [currentFitsPrevious, previousFitsCurrent] = await Promise.all([
      tscOk(base, currentFitsPreviousTs),
      tscOk(base, previousFitsCurrentTs),
    ]);
    return [
      previousSemVer,
      currentSemVer,
      currentFitsPrevious,
      previousFitsCurrent,
    ];
  });
}

/**
 * Main Liskov SemVer executor.
 *
 * @param {boolean} errorOnDirty - Whether a dirty git root is an error or not.
 * @returns {Promise<string>} Resolves to the semver `string` determined to be adequate for the current changes.
 */
async function main(errorOnDirty) {
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
    return semver.parse(previousVersion);
  }

  const [previousSemVer, currentSemVer, forwards, backwards] =
    await liskovSemVerForwardsBackwards(root, previousVersion, currentVersion);

  process.stderr.write(`[PREV SEMVER] ${previousSemVer}\n`);
  process.stderr.write(`[CURR SEMVER] ${currentSemVer}\n`);

  let newSemVer = "0.1.0";
  if (forwards) {
    if (backwards) {
      // patch
      process.stderr.write(`[NEXT SEMVER] <PATCH>\n`);
      newSemVer = semver.inc(previousSemVer, "patch");
    } else {
      // minor
      process.stderr.write(`[NEXT SEMVER] <MINOR>\n`);
      newSemVer = semver.inc(previousSemVer, "minor");
    }
  } else if (0 === semver.major(previousSemVer)) {
    // minor
    process.stderr.write(`[NEXT SEMVER] <0-MAJOR>\n`);
    newSemVer = semver.inc(previousSemVer, "minor");
  } else {
    // major
    process.stderr.write(`[NEXT SEMVER] <MAJOR>\n`);
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
  process.stdout.write(`${await main(argv.errorOnDirty)}\n`);
  process.exit(0);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
