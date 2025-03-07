#!/usr/bin/env node
const { writeFileSync } = require("fs");

async function main(url) {
  let text = await fetch(url).then((res) => res.text());
  text = text.replace(/^.*?\nBelow is the.*?\n\s+/s, "");
  text = text.replace(/^#(#+)/m, "$1");
  text = text.replace(
    /\.\.\/\.gitbook\/assets/g,
    "https://raw.githubusercontent.com/dimikot/ent-framework/refs/heads/main/gitbook/.gitbook/assets",
  );
  writeFileSync(`${__dirname}/../README.md`, text);
}

main(
  "https://raw.githubusercontent.com/dimikot/ent-framework/refs/heads/main/gitbook/advanced/database-schema-migrations.md",
).catch((e) => {
  console.error(e);
  process.exit(1);
});
