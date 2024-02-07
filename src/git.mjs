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
import git from "isomorphic-git";

export async function getTags(dir) {
  let tags = Array.from(new Set(await git.listTags({ fs, dir })));
  tags.sort();
  return tags;
}

export async function getBranches(dir) {
  let branches = Array.from(new Set(await git.listBranches({ fs, dir })));
  branches.sort();
  return branches;
}

export async function getTagsAndBranches(dir) {
  let tagsAndBranches = Array.from(
    new Set((await Promise.all([getTags(dir), getBranches(dir)])).flat())
  );
  tagsAndBranches.sort();
  return tagsAndBranches;
}

export async function getCurrentBranch(dir) {
  return (await git.currentBranch({ fs, dir })) ?? null;
}

export async function isDirty(dir) {
  return (await git.statusMatrix({ fs, dir })).some(
    ([_, head, workDir, stage]) => head * workDir * stage !== 1
  );
}

export async function wellOrdered(dir, oldRef, newRef) {
  const [newOid, oldOid] = await Promise.all([
    git.resolveRef({ fs, dir, ref: oldRef }),
    git.resolveRef({ fs, dir, ref: newRef }),
  ]);
  return git.isDescendent({ fs, dir, oldOid, newOid });
}
