/*
 * .mjs extension + package.json "type": "module" both force ESM loading
 * Belt-and-braces: keeps loading correctly under Node 24 module resolution
 * even if either drifts. See https://nodejs.org/api/packages.html#determining-module-system
 *
 * header-max-length raised from the conventional 100 to 120: GitHub appends
 * ` (#NN)` (4-7 chars) to squash-merge subjects, so any PR title >=94 chars
 * trips the default cap on a stacked-PR umbrella scan even though the raw title
 * was fine. 120 matches Angular / Nx convention
 *
 * This cap applies to PR titles too. The CI `pr-title` job pipes the raw title
 * through `commitlint` using this same config, so there is no stricter check
 * anywhere: a 120-character PR title passes. An earlier version of this comment
 * claimed a 100-char check at a `validate-pr-title` job, and neither the job name
 * nor the check existed
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 120],
  },
};
