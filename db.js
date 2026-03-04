const fs = require("fs");

function load() {
  if (!fs.existsSync("./warnings.json")) {
    fs.writeFileSync("./warnings.json", JSON.stringify({}));
  }
  return JSON.parse(fs.readFileSync("./warnings.json"));
}

function save(data) {
  fs.writeFileSync("./warnings.json", JSON.stringify(data, null, 2));
}

function addWarning(guild, user, reason) {
  const db = load();
  if (!db[guild]) db[guild] = {};
  if (!db[guild][user]) db[guild][user] = [];

  db[guild][user].push(reason);
  save(db);

  return db[guild][user];
}

function getWarnings(guild, user) {
  const db = load();
  return db[guild]?.[user] || [];
}

function clearWarnings(guild, user) {
  const db = load();
  if (db[guild]) db[guild][user] = [];
  save(db);
}

module.exports = { addWarning, getWarnings, clearWarnings };