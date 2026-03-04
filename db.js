const fs = require("fs");
const FILE = "./data.json";

function load() {
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({
    warnings: {}, afk: {}, reminders: [], sticky: {}, cases: {}
  }, null, 2));
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}
function save(db) {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2), "utf8");
}

function nextCase(guildId) {
  const db = load();
  db.cases[guildId] ??= 0;
  db.cases[guildId] += 1;
  save(db);
  return db.cases[guildId];
}

function addWarning(guildId, userId, entry) {
  const db = load();
  db.warnings[guildId] ??= {};
  db.warnings[guildId][userId] ??= [];
  db.warnings[guildId][userId].push(entry);
  save(db);
  return db.warnings[guildId][userId];
}
function getWarnings(guildId, userId) {
  const db = load();
  return db.warnings[guildId]?.[userId] ?? [];
}
function clearWarnings(guildId, userId) {
  const db = load();
  db.warnings[guildId] ??= {};
  db.warnings[guildId][userId] = [];
  save(db);
}

function setAFK(guildId, userId, msg) {
  const db = load();
  db.afk[guildId] ??= {};
  db.afk[guildId][userId] = { msg, at: Date.now() };
  save(db);
}
function getAFK(guildId, userId) {
  const db = load();
  return db.afk[guildId]?.[userId] ?? null;
}
function clearAFK(guildId, userId) {
  const db = load();
  if (db.afk[guildId]) delete db.afk[guildId][userId];
  save(db);
}

function setSticky(guildId, channelId, text) {
  const db = load();
  db.sticky[guildId] ??= {};
  db.sticky[guildId][channelId] = { text, lastMessageId: null };
  save(db);
}
function getSticky(guildId, channelId) {
  const db = load();
  return db.sticky[guildId]?.[channelId] ?? null;
}
function removeSticky(guildId, channelId) {
  const db = load();
  if (db.sticky[guildId]) delete db.sticky[guildId][channelId];
  save(db);
}
function setStickyLastId(guildId, channelId, msgId) {
  const db = load();
  if (!db.sticky[guildId]?.[channelId]) return;
  db.sticky[guildId][channelId].lastMessageId = msgId;
  save(db);
}

module.exports = {
  nextCase,
  addWarning, getWarnings, clearWarnings,
  setAFK, getAFK, clearAFK,
  setSticky, getSticky, removeSticky, setStickyLastId
};
