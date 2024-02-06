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

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const argv = yargs(hideBin(process.argv))
  .wrap(process.stdout.columns)
  .scriptName("liskov-semver")
  .env("LISKOV_SEMVER")
  .help("h")
  .alias("h", "?")
  .alias("h", "help")
  .alias("V", "version")
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
  .usage(
    "$0 <package> [<semver>]",
    "Generate new package version or validate against provided one.",
    (yargs) =>
      yargs
        .option("from", {
          alias: "f",
          defaultDescription: "highest SemVer committed tag",
          description: 'branch to use as "old" branch',
          global: true,
          group: "Branches:",
          nargs: 1,
          requiresArg: true,
          string: true,
        })
        .option("to", {
          alias: "t",
          defaultDescription: "current branch",
          description: 'branch to use as "new" branch',
          global: true,
          group: "Branches:",
          nargs: 1,
          requiresArg: true,
          string: true,
        })
        .option("update", {
          boolean: true,
          default: true,
          description: "update package.json with new version",
          global: true,
          group: "Control:",
        })
        .option("tag", {
          boolean: true,
          default: true,
          description: "create git tag with new version",
          global: true,
          group: "Control:",
        })
        .option("write", {
          alias: "w",
          boolean: true,
          default: true,
          description: "update package.json and create git tag",
          global: true,
          group: "Control:",
          implies: ["tag", "update"],
        })
        .option("error-on-dirty", {
          boolean: true,
          default: true,
          description: "show error if the working directory is not clean",
          global: true,
          group: "Errors:",
        })
        .option("silent", {
          alias: ["quiet", "q", "s"],
          boolean: true,
          default: false,
          description: "don't show output, simply use return value",
          global: true,
        })
        .option("verbose", {
          alias: "v",
          count: true,
          default: 0,
          description: "show detailed output, may be repeated",
          global: true,
        })
        .positional("package", {
          demandOption: true,
          description: "path to the package.json file to use for entry points",
          normalize: true,
          string: true,
        })
        .positional("semver", {
          description: "SemVer string to check against",
          string: true,
        })
  )
  .example([
    ['$0 some/package.json', 'Generate next SemVer tag, update package.json, and create corresponding git tag'],
    ['$0 some/package.json --no-update', 'Generate next SemVer tag, only print it to stdout'],
    ['$0 some/package.json --no-error-on-dirty', "Don't generate an error if the working directory is not clean"],
    ['$0 some/package.json v1.2.3', 'If v1.2.3 is a valid "next" tag, update package.json, and create corresponding git tag; otherwise exit with error'],
  ])
  .epilog('Boolean options have "opposites" starting with a "--no-" prefix, eg. "--no-update".')
  .epilog('')
  .epilog('Copyright (C) 2024  La Crypta')
  .epilog('Released under the AGPLv3+ License <https://www.gnu.org/licenses/agpl-3.0.html>')
  .parse();

console.log(argv);
