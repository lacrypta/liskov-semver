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
import semver from "semver";

import path from "path";

import { getCurrentBranch, getTagsAndBranches } from "./git.mjs";
import { canReadWrite } from "./files.mjs";

export async function parseArgs(args) {
  const argv = await yargs(hideBin(args))
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
    .usage(
      "$0 [<dir>] [<semver>]",
      "Generate new package version or validate against provided one.",
      (yargs) =>
        yargs
          .option("from", {
            alias: "f",
            default: "",
            defaultDescription: "highest SemVer committed ref",
            description: 'ref to use as "old" version',
            global: true,
            group: "Branches:",
            nargs: 1,
            requiresArg: true,
            string: true,
          })
          .option("to", {
            alias: "t",
            default: "",
            defaultDescription: "current branch",
            description: 'ref to use as "new" version',
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
          .option("error-on-unreachable", {
            boolean: true,
            default: true,
            description:
              'show error if the "from" ref cannot reach the "to" ref',
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
          .positional("dir", {
            coerce: (arg) => path.resolve(process.cwd(), arg),
            default: "./",
            defaultDescription: "the directory where the package.json resides",
            description:
              "path to the package.json file to use for entry points and current version",
            normalize: true,
            string: true,
          })
          .positional("semver", {
            coerce: (arg) => semver.clean(arg, { loose: true }) ?? "",
            description: "SemVer string to check against",
            string: true,
          })
    )
    .check(async (args, _options) => {
      let errors = false;

      if (args._.length !== 0) {
        console.error(`Too many arguments given [${args._.join(", ")}]`);
        errors = true;
      }
      if ("" === args.semver) {
        console.error(`Invalid <semver> given`);
        errors = true;
      }

      const packageJson = path.resolve(
        process.cwd(),
        path.join(args.dir, "package.json")
      );

      if (!(await canReadWrite(packageJson))) {
        console.error(
          `Cannot read/write specified package.json [${packageJson}]`
        );
        errors = true;
      }

      const tagsAnsBranches = await getTagsAndBranches(
        path.dirname(packageJson)
      );

      if ("" !== args.from && !tagsAnsBranches.includes(args.from)) {
        console.error(`Not a valid "from" ref [${args.from}]`);
        errors = true;
      }
      if ("" !== args.to && !tagsAnsBranches.includes(args.to)) {
        console.error(`Not a valid "to" ref [${args.to}]`);
        errors = true;
      }

      return !errors;
    }, true)
    .example([
      [
        "$0 somewhere",
        "Generate next SemVer tag, update somewhere/package.json, and create corresponding git tag",
      ],
      [
        "$0 somewhere/package.json --no-update",
        "Generate next SemVer tag, only print it to stdout",
      ],
      [
        "$0 somewhere/package.json --no-error-on-dirty",
        "Don't generate an error if the working directory is not clean",
      ],
      [
        "$0 somewhere/package.json v1.2.3",
        'If v1.2.3 is a valid "next" tag, update somewhere/package.json, and create corresponding git tag; otherwise exit with error',
      ],
    ])
    .epilog(
      'Boolean options have "opposites" starting with a "--no-" prefix, eg. "--no-update".'
    )
    .epilog("")
    .epilog("Copyright (C) 2024  La Crypta")
    .epilog(
      "Released under the AGPLv3+ License <https://www.gnu.org/licenses/agpl-3.0.html>"
    )
    .parse();

  if ("" === argv.from) {
    let semverTagsAndBranches = tagsAnsBranches.filter(
      (tagOrBranch) => null !== semver.valid(tagOrBranch)
    );
    semverTagsAndBranches.sort(semver.rcompare);
    argv.from = semverTagsAndBranches[0] ?? null;
  }
  if ("" === argv.to) {
    argv.to = await getCurrentBranch(argv.dir);
  }

  return {
    packageJson: path.resolve(
      process.cwd(),
      path.join(argv.dir, "package.json")
    ),
    semver: argv.semver ?? null,
    from: argv.from,
    to: argv.to,
    update: argv.update,
    tag: argv.tag,
    errorOnDirty: argv.errorOnDirty,
    errorOnUnreachable: argv.errorOnUnreachable,
    verbosity: argv.silent ? 0 : argv.verbose,
  };
}
