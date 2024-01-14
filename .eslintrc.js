"use strict";
module.exports = require("../../.eslintrc.base.js")(__dirname, {
  "import/no-extraneous-dependencies": "error",
  "lodash/import-scope": ["error", "method"],
});
