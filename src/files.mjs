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

export async function canReadWrite(file) {
  return fs.promises.access(file, fs.constants.R_OK | fs.constants.W_OK).then(
    () => true,
    () => false
  );
}

export async function createTempDirs(prefix, subDirs) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  const tempSubDirs = subDirs.map((subDir) => path.join(tempDir, subDir));
  await Promise.all(tempSubDirs.map(fs.promises.mkdir));
  return [tempDir, ...tempSubDirs];
}
