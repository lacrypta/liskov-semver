# Liskov SemVer

A [SemVer](https://semver.org/) checker using [Liskov's Substitution Principle](https://en.wikipedia.org/wiki/Liskov_substitution_principle).

## TL;DR

Simply run `npx @lacrypta/liskov-semver` on a TypeScript project to get the smallest SemVer you'll need to use during publishing.

## How does it work?

This script will first clone two different versions of your package: the _latest_ tag with a SemVer-like name, and the _current_ branch.
Once cloned, it will install their dependencies, build them, pack them, and install them both side-by-side (under different names) on a scratch directory.

In said scratch directory, a new package is created, that declares both of these as dependencies.
They will be installed, and two TypeScript files will be created therein:

```typescript
// newToOld.ts
import * as oldVersion from "./oldVersion";
import * as newVersion from "./newVersion";

((_: typeof oldVersion): void => {})(newVersion);
```

and

```typescript
// oldToNew.ts
import * as oldVersion from "./oldVersion";
import * as newVersion from "./newVersion";

((_: typeof newVersion): void => {})(oldVersion);
```

Of course, the _actual_ TypeScript files used will be somewhat more involved (in order to deal with multiple entry points, for example), but these will do by way of example.

Although somewhat strange, what these files do is effective check whether the "new" version's API is Liskov-compatible with the "old" one, and vice-versa.

We then simply call `tsc` in order to type-check each of these files.
This may yield different results, according to the table below:

| `tsc newToOld.ts` | `tsc oldToNew.ts` | Result                                | Bump  |
| :---------------: | :---------------: | :------------------------------------ | :---: |
|      **OK**       |      **OK**       | Versions are mutually compatible      | patch |
|      **OK**       |     **FAIL**      | New version is backwards-compatible   | minor |
|     **FAIL**      |      **--**       | New version is backwards-incompatible | major |

Based off of the value of `version` in the `package.json` file for the "old" version, this script will bump the appropriate version segment, and print it on `stdout`, provided this is larger than the value of `version` in the `package.json` file for the "new" version.

### Major Version Handling

This tool will _never_ update the major version when it is `0`, updating the minor version instead.
The rationale behind this is that `0` major versions indicate unstable development, and as such, it should be manually bumped to the first production version.

## Usage

Call `npx @lacrypta/liskov-semver --help` for usage info:

```sh
$ npx @lacrypta/liskov-semver --help
Options:
      --version               Show version number                         [boolean]
  -h, -?, --help              Show help                                   [boolean]
      --error-on-dirty        show error if the working directory is not clean
                                                          [boolean] [default: true]

Boolean options have "opposites" starting with a "--no-" prefix, eg.
"--no-error-on-dirty".

Copyright (C) 2024  La Crypta
Released under the AGPLv3+ License <https://www.gnu.org/licenses/agpl-3.0.html>
```

### Testing

You may run tests like so:

```sh
$ tests/test
Testing "Initial commit" ... passed!
Testing "Make an inconsequential change" ... passed!
Testing "Make a minor change" ... passed!
Testing "Make a major change" ... passed!
Testing "Make yet another inconsequential change" ... passed!
Testing "Make yet another minor change" ... passed!
Testing "Make yet another major change" ... passed!
All tests passed! :D
```

## What can you use it for?

Running this script prior to publishing will ensure the package is published with a semantically-correct SemVer number (at least as far as the TypeScript public API goes).

One way of doing this is:

```javascript
// package.json
{
  ...,
  "scripts": {
    ...,
    "prepublishOnly": "npm pkg set version=$(npx @lacrypta/liskov-semver)",
    ...
  },
  ...
}
```

This will ensure the `package.json`'s `version` field is updated prior to publishing.

## Is this enough for my versioning needs?

No.

This tool will deal with "structural" changes in your public API, it has no way of detecting "semantic" changes introduced without modifying the API's structure.

There are, of course, techniques and practices that can alleviate this problem, and most of them consist of turning "semantic" changes into "structural" changes (ie. interface tagging, entry points versioning, etc.), and if you're using one of these, this tool will pick up on those changes just as well.
