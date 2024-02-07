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

import fs from "fs";
import os from "os";
import path from "path";

import { parseArgs } from "./args.mjs";
import { isDirty, wellOrdered } from "./git.mjs";
import { createTempDirs } from "./files.mjs";

// ----------------------------------------------------------------------------------------------------------------------------------------

const args = await parseArgs(process.argv);

if (args.errorOnDirty && isDirty(path.dirname(args.packageJson))) {
  // ERROR: dirty working tree
}
if (null === args.from) {
  // No origin version ---> update / tag with 0.1.0 and be done with it
}
if (args.from === args.to) {
  // Nothing to compare ---> no need to update / tag anything, simply output and be done with it
}
if (
  args.errorOnUnreachable &&
  !wellOrdered(path.dirname(args.packageJson), args.from, args.to)
) {
  // ERROR: cannot get from "from" to "to"
}

// create temp dirs
let tempDir = null;
let oldVersionDir = null;
let newVersionDir = null;
let oldPackDir = null;
let newPackDir = null;
let workingDir = null;
try {
  const [tempDir, oldVersionDir, newVersionDir, oldPackDir, newPackDir, workingDir] =
    await createTempDirs("liskov-semver-", [
      "oldVersion",
      "newVersion",
      "oldPack",
      "newPack",
      "working",
    ]);
} finally {
  if (null !== tempDir) {
    try {
      fs.promises.rm(tempDir, { force: true, recursive: true, maxRetries: 5 });
    } catch {
      console.error(`Could not remove temporary directory [${tempDir}]`);
    }
  }
}

// clone into old & new
// install old and new
// pack old and new
// create package.json in working
// synthesize newToOld.ts and oldToNew.ts

const packageJsonContents = JSON.parse(fs.readFileSync(packageJson));

// ----------------------------------------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------------------------------------

async function createAllTempDirs() {
  return;
}

// ----------------------------------------------------------------------------------------------------------------------------------------

function getVersionFromPackageJson(packageContents) {
  return packageContents.version;
}

function getEntryPointsFromPackageJson(packageContents) {
  return Object.entries(packageContents.exports ?? { "": { types: "" } })
    .filter(([_key, value]) => typeof value === "object" && "types" in value)
    .map(([key, _value]) => path.normalize(key));
}

// ----------------------------------------------------------------------------------------------------------------------------------------

console.log(await parseArgs(process.argv));

process.exit(1);

const packageDirectory = path.dirname(packageJson);
const packageContents = JSON.parse(fs.readFileSync(packageJson));

console.log(argv);

console.log(`Dirty: ${await isDirty(packageDirectory)}`);
console.log(`Tags: [${(await getVersionTags(packageDirectory)).join(", ")}]`);
console.log(`Version: ${getVersionFromPackageJson(packageContents)}`);
console.log(
  `Entries: [${getEntryPointsFromPackageJson(packageContents).join(", ")}]`
);
console.log(`Tmps: [${(await createAllTempDirs()).join(", ")}]`);
