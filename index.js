const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require("discord.js");

const fs = require("fs");

// =====================
// Config / Storage
// =====================
const TOKEN = (process.env.TOKEN || "").trim();
if (!TOKEN) {
  console.log("Missing TOKEN");
  process.exit(1);
}

const DARK_YELLOW = 0xD4A017; // darker yellow banner

const DATA_FILE = "./data.json";
function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ guilds: {}, warnings: {}, levels: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function saveDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
let db = loadDB();

// guild settings helpers
function gSettings(guildId) {
  db.guilds[guildId] ??= {
    prefix: "?",
    modlogChannelId: null,
    verifyChannelId: null,
    unverifiedRoleId: null,
    verifiedRoleId: null,
    welcomeChannelId: null,
    welcomeMessage: "Welcome {user} to {server}!",
    levelUpChannelId: null,
    levelRoleRewards: [] // [{level: 5, roleId: "..."}, ...]
  };
  return db.guilds[guildId];
}

// warnings helpers
function getWarns(guildId, userId) {
  db.warnings[guildId] ??= {};
  db.warnings[guildId][userId] ??= [];
  return db.warnings[guildId][userId];
}
function addWarn(guildId, userId, entry) {
  const arr = getWarns(guildId, userId);
  arr.push(entry);
  saveDB(db);
  return arr;
}
function clearWarns(guildId, userId) {
  db.warnings[guildId] ??= {};
  db.warnings[guildId][userId] = [];
  saveDB(db);
}

// leveling helpers
function lvlData(guildId, userId) {
  db.levels[guildId] ??= {};
  db.levels[guildId][userId] ??= { xp: 0, level: 0, lastXpAt: 0 };
  return db.levels[guildId][userId];
}
function xpNeededFor(level) {
  // smooth curve
  // level 0->1 around 100, then grows
  return 5 * (level ** 2) + 50 * level + 100;
}
function calcLevelFromXP(xp) {
  let level = 0;
  while (xp >= xpNeededFor(level)) level++;
  return level;
}

// =====================
// Discord Client
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel]
});

// =====================
// UI helpers
// =====================
function E(desc, title = null) {
  const em = new EmbedBuilder().setColor(DARK_YELLOW).setDescription(desc).setTimestamp();
  if (title) em.setTitle(title);
  return em;
}

function dynoUsageEmbed({ command, description, usage, example, cooldownSec = 3 }) {
  return new EmbedBuilder()
    .setColor(DARK_YELLOW)
    .setTitle(`Command: ${command}`)
    .addFields(
      { name: "Description", value: description || "—" },
      { name: "Cooldown", value: `${cooldownSec} seconds`, inline: true },
      { name: "Usage", value: usage || "—" },
      { name: "Example", value: example || "—" },
    )
    .setTimestamp();
}

async function fetchTextChannel(guild, channelId) {
  if (!channelId) return null;
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return null;
  return ch;
}

async function modlog(guild, text) {
  const s = gSettings(guild.id);
  const ch = await fetchTextChannel(guild, s.modlogChannelId);
  if (!ch) return;
  await ch.send({ embeds: [E(text, "Mod Log")] }).catch(() => {});
}

// mention OR userId support
function parseUserId(raw) {
  if (!raw) return null;
  const m = raw.match(/^<@!?(\d+)>$/);
  if (m) return m[1];
  if (/^\d{15,25}$/.test(raw)) return raw;
  return null;
}
async function resolveMember(guild, raw) {
  const id = parseUserId(raw);
  if (!id) return null;
  return await guild.members.fetch(id).catch(() => null);
}

function parseRoleId(raw) {
  if (!raw) return null;
  const m = raw.match(/^<@&(\d+)>$/);
  if (m) return m[1];
  if (/^\d{15,25}$/.test(raw)) return raw;
  return null;
}

function uptimeStr() {
  const ms = Date.now() - startedAt;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}

const startedAt = Date.now();

// =====================
// Captcha (button + modal)
// =====================
const captchaMap = new Map(); // userId -> answer

function makeCaptchaQuestion() {
  const a = 2 + Math.floor(Math.random() * 9);
  const b = 2 + Math.floor(Math.random() * 9);
  return { q: `${a} + ${b}`, ans: String(a + b) };
}

function verifyPanelEmbed(guildName) {
  return new EmbedBuilder()
    .setColor(DARK_YELLOW)
    .setTitle("Verification")
    .setDescription(
      `To access **${guildName}**, click **Verify** and solve the captcha.\n\nThis helps stop spam/bot accounts.`
    )
    .setTimestamp();
}

function verifyRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_start")
      .setLabel("Verify")
      .setStyle(ButtonStyle.Primary)
  );
}

// =====================
// Slash Commands Registration
// =====================
function slashCommands() {
  // Core commands requested (more can be added anytime)
  const cmds = [
    new SlashCommandBuilder().setName("commands").setDescription("Show command list (MEE6-style menu)"),

    // Moderation & security
    new SlashCommandBuilder().setName("ban").setDescription("Permanently bans a user.")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder().setName("unban").setDescription("Unban a user by User ID.")
      .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder().setName("kick").setDescription("Kicks a user (they can rejoin).")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder().setName("timeout").setDescription("Timeout a user for X minutes.")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
      .addIntegerOption(o => o.setName("minutes").setDescription("Minutes").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder().setName("warn").setDescription("Warn a user (saved in database).")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder().setName("warnings").setDescription("Show warnings of a user.")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)),

    new SlashCommandBuilder().setName("clearwarns").setDescription("Clear warnings of a user.")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)),

    new SlashCommandBuilder().setName("purge").setDescription("Bulk delete messages (1-100).")
      .addIntegerOption(o => o.setName("amount").setDescription("1-100").setRequired(true)),

    new SlashCommandBuilder().setName("lock").setDescription("Lock current channel (disable send messages)."),
    new SlashCommandBuilder().setName("unlock").setDescription("Unlock current channel."),
    new SlashCommandBuilder().setName("slowmode").setDescription("Set slowmode for this channel.")
      .addIntegerOption(o => o.setName("seconds").setDescription("0-21600").setRequired(true)),

    new SlashCommandBuilder().setName("nuke").setDescription("Clone and delete channel to wipe chat history."),

    // Utility
    new SlashCommandBuilder().setName("ping").setDescription("Check bot latency."),
    new SlashCommandBuilder().setName("serverinfo").setDescription("Show server info."),
    new SlashCommandBuilder().setName("userinfo").setDescription("Show user info.")
      .addUserOption(o => o.setName("user").setDescription("User (optional)")),
    new SlashCommandBuilder().setName("avatar").setDescription("Show user avatar.")
      .addUserOption(o => o.setName("user").setDescription("User (optional)")),
    new SlashCommandBuilder().setName("banner").setDescription("Show user banner.")
      .addUserOption(o => o.setName("user").setDescription("User (optional)")),
    new SlashCommandBuilder().setName("uptime").setDescription("Show bot uptime."),
    new SlashCommandBuilder().setName("botinfo").setDescription("Show bot statistics."),
    new SlashCommandBuilder().setName("poll").setDescription("Create a poll (👍/👎).")
      .addStringOption(o => o.setName("question").setDescription("Poll question").setRequired(true)),

    // Setup / settings
    new SlashCommandBuilder().setName("setmodlogs").setDescription("Set mod logs channel.")
      .addChannelOption(o => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)),

    new SlashCommandBuilder().setName("setup-verify").setDescription("Setup captcha verification.")
      .addChannelOption(o => o.setName("channel").setDescription("Verify channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addRoleOption(o => o.setName("unverified").setDescription("Unverified role").setRequired(true))
      .addRoleOption(o => o.setName("verified").setDescription("Verified role").setRequired(true)),

    new SlashCommandBuilder().setName("setup-welcome").setDescription("Setup welcome channel & message.")
      .addChannelOption(o => o.setName("channel").setDescription("Welcome channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName("message").setDescription("Use {user} and {server}").setRequired(true)),

    new SlashCommandBuilder().setName("prefix").setDescription("Change prefix commands symbol.")
      .addStringOption(o => o.setName("prefix").setDescription("Example: ? or !").setRequired(true)),

    // AFK
    new SlashCommandBuilder().setName("afk").setDescription("Set AFK status.")
      .addStringOption(o => o.setName("message").setDescription("AFK message")),

    // Leveling
    new SlashCommandBuilder().setName("rank").setDescription("Show your rank / level.")
      .addUserOption(o => o.setName("user").setDescription("User (optional)")),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Show top XP leaderboard."),
    new SlashCommandBuilder().setName("setlevelchannel").setDescription("Set level-up announcement channel.")
      .addChannelOption(o => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName("levelrole").setDescription("Add a role reward at a level.")
      .addIntegerOption(o => o.setName("level").setDescription("Level number").setRequired(true))
      .addRoleOption(o => o.setName("role").setDescription("Role to give").setRequired(true)),
  ];

  return cmds.map(c => c.toJSON());
}

async function registerSlash() {
  const CLIENT_ID = process.env.CLIENT_ID;
  const GUILD_ID = process.env.GUILD_ID;
  if (!CLIENT_ID || !GUILD_ID) {
    console.log("Slash commands not registered (missing CLIENT_ID or GUILD_ID).");
    return;
  }
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: slashCommands(),
  });
  console.log("Slash commands registered.");
}

// =====================
// /commands MEE6-style menu
// =====================
function commandsMenuEmbed(category) {
  const cat = category || "home";

  const pages = {
    home: {
      title: "Commands",
      desc: "Select the plugin for which you need help.",
      fields: []
    },
    mod: {
      title: "Moderation & Security",
      desc: [
        "/ban - Permanently bans a user.",
        "/unban - Unban by User ID.",
        "/kick - Removes a user (can rejoin).",
        "/timeout - Timeout a user for X minutes.",
        "/warn - Warn a user (saved).",
        "/warnings - Show a user's warnings.",
        "/clearwarns - Clear a user's warnings.",
        "/purge - Bulk delete messages.",
        "/lock - Lock channel.",
        "/unlock - Unlock channel.",
        "/slowmode - Set channel slowmode.",
        "/nuke - Wipe channel (clone & delete).",
        "/setmodlogs - Set mod logs channel.",
      ].join("\n"),
      fields: []
    },
    utility: {
      title: "Utility",
      desc: [
        "/ping - Bot latency.",
        "/serverinfo - Server details.",
        "/userinfo - User details.",
        "/avatar - Show avatar.",
        "/banner - Show banner.",
        "/uptime - Bot uptime.",
        "/botinfo - Bot info/stats.",
        "/poll - Create poll.",
        "/prefix - Change prefix symbol.",
      ].join("\n"),
      fields: []
    },
    verify: {
      title: "Verification",
      desc: [
        "/setup-verify - Setup captcha verification.",
        "Bot will give Unverified role on join and require captcha in verify channel.",
      ].join("\n"),
      fields: []
    },
    leveling: {
      title: "Leveling",
      desc: [
        "/rank - Show level & XP.",
        "/leaderboard - Top XP.",
        "/setlevelchannel - Set level-up channel.",
        "/levelrole - Give role at a level (reward).",
      ].join("\n"),
      fields: []
    },
    extra: {
      title: "Extra",
      desc: [
        "/setup-welcome - Welcome channel/message.",
        "/afk - AFK status.",
        "Prefix commands are still available (example: ?sticky).",
      ].join("\n"),
      fields: []
    }
  };

  const p = pages[cat] || pages.home;
  const em = new EmbedBuilder()
    .setColor(DARK_YELLOW)
    .setTitle(p.title)
    .setDescription(p.desc)
    .setTimestamp();

  for (const f of (p.fields || [])) em.addFields(f);
  return em;
}

function commandsMenuRow(selected = "home") {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("commands_menu")
      .setPlaceholder("Select category")
      .addOptions(
        { label: "Home", value: "home", default: selected === "home" },
        { label: "Moderation & Security", value: "mod", default: selected === "mod" },
        { label: "Utility", value: "utility", default: selected === "utility" },
        { label: "Verification", value: "verify", default: selected === "verify" },
        { label: "Leveling", value: "leveling", default: selected === "leveling" },
        { label: "Extra", value: "extra", default: selected === "extra" },
      )
  );
}

// =====================
// Prefix command handler (keep old commands + more)
// =====================
async function handlePrefix(message) {
  const s = gSettings(message.guild.id);
  const prefix = s.prefix || "?";
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = (args.shift() || "").toLowerCase();

  // Minimal: keep your sticky old command (simple)
  if (cmd === "sticky") {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "set") {
      if (!hasPerm(message.member, PermissionsBitField.Flags.ManageMessages)) {
        return message.channel.send({ embeds: [E("Missing permission: Manage Messages", "Error")] });
      }
      const text = message.content.split(/\s+/).slice(2).join(" ").trim();
      if (!text) {
        return message.channel.send({
          embeds: [dynoUsageEmbed({
            command: `${prefix}sticky set`,
            description: "Set sticky message for this channel.",
            usage: `${prefix}sticky set <text...>`,
            example: `${prefix}sticky set Please read the rules above.`
          })]
        });
      }
      // store sticky in guild settings as a map
      s.sticky ??= {};
      s.sticky[message.channel.id] = { text, lastMessageId: null };
      saveDB(db);
      return message.channel.send({ embeds: [E("Sticky message set for this channel.", "Sticky")] });
    }

    if (sub === "remove") {
      if (!hasPerm(message.member, PermissionsBitField.Flags.ManageMessages)) {
        return message.channel.send({ embeds: [E("Missing permission: Manage Messages", "Error")] });
      }
      s.sticky ??= {};
      delete s.sticky[message.channel.id];
      saveDB(db);
      return message.channel.send({ embeds: [E("Sticky message removed for this channel.", "Sticky")] });
    }

    if (sub === "show") {
      const st = s.sticky?.[message.channel.id];
      if (!st) return message.channel.send({ embeds: [E("No sticky message set here.", "Sticky")] });
      return message.channel.send({ embeds: [E(st.text, "Sticky")] });
    }

    return message.channel.send({
      embeds: [dynoUsageEmbed({
        command: `${prefix}sticky`,
        description: "Sticky message commands.",
        usage: `${prefix}sticky set <text...>\n${prefix}sticky remove\n${prefix}sticky show`,
        example: `${prefix}sticky set Welcome to GKH!`
      })]
    });
  }

  // quick help (prefix)
  if (cmd === "help") {
    return message.channel.send({
      embeds: [E(`Use **/commands** for the full menu.\n\nPrefix: \`${prefix}\`\nExample: \`${prefix}sticky set ...\``, "Help")]
    });
  }
}

// =====================
// Sticky repost behavior
// =====================
async function handleStickyBehavior(message) {
  if (!message.guild || message.author.bot) return;
  const s = gSettings(message.guild.id);
  const st = s.sticky?.[message.channel.id];
  if (!st) return;

  if (st.lastMessageId && message.id === st.lastMessageId) return;

  setTimeout(async () => {
    try {
      const sent = await message.channel.send({ embeds: [E(st.text, "Sticky")] });
      st.lastMessageId = sent.id;
      saveDB(db);
    } catch {}
  }, 1200);
}

// =====================
// AFK behavior
// =====================
async function handleAFK(message) {
  if (!message.guild || message.author.bot) return;

  const userAFK = db.guilds[message.guild.id]?.afk?.[message.author.id];
  if (userAFK) {
    delete db.guilds[message.guild.id].afk[message.author.id];
    saveDB(db);
    await message.channel.send({ embeds: [E(`<@${message.author.id}> is no longer AFK.`, "AFK")] }).catch(() => {});
  }

  for (const u of message.mentions.users.values()) {
    const afk = db.guilds[message.guild.id]?.afk?.[u.id];
    if (afk) {
      await message.channel.send({ embeds: [E(`<@${u.id}> is AFK: ${afk.msg}`, "AFK")] }).catch(() => {});
    }
  }
}

// =====================
// Leveling (Arcane-like)
// =====================
const xpCooldown = new Map(); // key guildId:userId -> timestamp

async function handleXP(message) {
  if (!message.guild || message.author.bot) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const last = xpCooldown.get(key) || 0;
  if (now - last < 60_000) return; // 60s cooldown

  xpCooldown.set(key, now);

  const data = lvlData(message.guild.id, message.author.id);
  const gain = 15 + Math.floor(Math.random() * 11); // 15-25
  data.xp += gain;

  const newLevel = calcLevelFromXP(data.xp);
  const oldLevel = data.level;
  data.level = newLevel;
  data.lastXpAt = now;
  saveDB(db);

  if (newLevel > oldLevel) {
    const s = gSettings(message.guild.id);

    // give role rewards
    const rewards = (s.levelRoleRewards || []).filter(r => r.level === newLevel);
    for (const r of rewards) {
      const role = await message.guild.roles.fetch(r.roleId).catch(() => null);
      if (role) {
        const member = await message.guild.members.fetch(message.author.id).catch(() => null);
        if (member) await member.roles.add(role).catch(() => {});
      }
    }

    // announce
    const channelId = s.levelUpChannelId || message.channel.id;
    const ch = await fetchTextChannel(message.guild, channelId) || message.channel;

    await ch.send({
      embeds: [E(`<@${message.author.id}> has reached level **${newLevel}**. GG!`, "Level Up")]
    }).catch(() => {});
  }
}

// =====================
// Member Join: verification + welcome
// =====================
client.on(Events.GuildMemberAdd, async (member) => {
  const s = gSettings(member.guild.id);

  // Welcome
  if (s.welcomeChannelId) {
    const ch = await fetchTextChannel(member.guild, s.welcomeChannelId);
    if (ch) {
      const msg = (s.welcomeMessage || "Welcome {user} to {server}!")
        .replaceAll("{user}", `<@${member.id}>`)
        .replaceAll("{server}", member.guild.name);
      ch.send({ embeds: [E(msg, "Welcome")] }).catch(() => {});
    }
  }

  // Verification role + panel
  if (s.unverifiedRoleId && s.verifiedRoleId && s.verifyChannelId) {
    const role = await member.guild.roles.fetch(s.unverifiedRoleId).catch(() => null);
    if (role) await member.roles.add(role).catch(() => {});

    const vch = await fetchTextChannel(member.guild, s.verifyChannelId);
    if (vch) {
      // Optional: you can send panel once manually too; we won't spam every join.
      // So only send DM-style ping once:
      vch.send({ embeds: [E(`Welcome <@${member.id}>. Please verify using the button below.`, "Verification")], components: [verifyRow()] })
        .catch(() => {});
    }
  }
});

// =====================
// Ready
// =====================
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerSlash().catch(err => console.log("Slash register error:", err?.message));
});

// =====================
// Message events
// =====================
client.on(Events.MessageCreate, async (message) => {
  await handleAFK(message);
  await handleStickyBehavior(message);
  await handleXP(message);

  if (!message.guild || message.author.bot) return;
  await handlePrefix(message);
});

// =====================
// Interactions (slash + menu + captcha)
// =====================
client.on(Events.InteractionCreate, async (interaction) => {
  // /commands menu select
  if (interaction.isStringSelectMenu() && interaction.customId === "commands_menu") {
    const value = interaction.values?.[0] || "home";
    return interaction.update({
      embeds: [commandsMenuEmbed(value)],
      components: [commandsMenuRow(value)]
    }).catch(() => {});
  }

  // Verify button
  if (interaction.isButton() && interaction.customId === "verify_start") {
    const s = gSettings(interaction.guild.id);

    if (!s.verifyChannelId || !s.unverifiedRoleId || !s.verifiedRoleId) {
      return interaction.reply({ ephemeral: true, embeds: [E("Verification is not configured yet. Use /setup-verify.", "Verify")] });
    }

    const { q, ans } = makeCaptchaQuestion();
    captchaMap.set(interaction.user.id, ans);

    const modal = new ModalBuilder()
      .setCustomId("verify_modal")
      .setTitle("Captcha Verification");

    const input = new TextInputBuilder()
      .setCustomId("captcha_answer")
      .setLabel(`Solve: ${q}`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Verify modal submit
  if (interaction.isModalSubmit() && interaction.customId === "verify_modal") {
    const s = gSettings(interaction.guild.id);

    const expected = captchaMap.get(interaction.user.id);
    const got = interaction.fields.getTextInputValue("captcha_answer").trim();

    if (!expected) {
      return interaction.reply({ ephemeral: true, embeds: [E("Captcha expired. Click Verify again.", "Verify")] });
    }

    if (got !== expected) {
      captchaMap.delete(interaction.user.id);
      return interaction.reply({ ephemeral: true, embeds: [E("Wrong captcha. Click Verify again.", "Verify")] });
    }

    captchaMap.delete(interaction.user.id);

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.reply({ ephemeral: true, embeds: [E("Member not found.", "Verify")] });

    const unv = await interaction.guild.roles.fetch(s.unverifiedRoleId).catch(() => null);
    const ver = await interaction.guild.roles.fetch(s.verifiedRoleId).catch(() => null);

    if (unv) await member.roles.remove(unv).catch(() => {});
    if (ver) await member.roles.add(ver).catch(() => {});

    await modlog(interaction.guild, `Action: Verify\nUser: ${interaction.user.tag} (${interaction.user.id})`);
    return interaction.reply({ ephemeral: true, embeds: [E("Verified successfully. Welcome!", "Verify")] });
  }

  // Slash commands
  if (!interaction.isChatInputCommand()) return;

  const name = interaction.commandName;
  const guild = interaction.guild;
  const member = interaction.member;

  const s = gSettings(guild.id);

  // /commands
  if (name === "commands") {
    return interaction.reply({
      ephemeral: true,
      embeds: [commandsMenuEmbed("home")],
      components: [commandsMenuRow("home")]
    });
  }

  // /setmodlogs
  if (name === "setmodlogs") {
    if (!hasPerm(member, PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Manage Server", "Error")] });
    }
    const ch = interaction.options.getChannel("channel", true);
    s.modlogChannelId = ch.id;
    saveDB(db);
    return interaction.reply({ embeds: [E(`Mod logs channel set to <#${ch.id}>`, "Settings")] });
  }

  // /setup-verify
  if (name === "setup-verify") {
    if (!hasPerm(member, PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Manage Server", "Error")] });
    }
    const ch = interaction.options.getChannel("channel", true);
    const unv = interaction.options.getRole("unverified", true);
    const ver = interaction.options.getRole("verified", true);

    s.verifyChannelId = ch.id;
    s.unverifiedRoleId = unv.id;
    s.verifiedRoleId = ver.id;
    saveDB(db);

    // send panel
    await ch.send({ embeds: [verifyPanelEmbed(guild.name)], components: [verifyRow()] }).catch(() => {});

    return interaction.reply({ embeds: [E(`Verification configured.\nChannel: <#${ch.id}>\nUnverified: <@&${unv.id}>\nVerified: <@&${ver.id}>`, "Settings")] });
  }

  // /setup-welcome
  if (name === "setup-welcome") {
    if (!hasPerm(member, PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Manage Server", "Error")] });
    }
    const ch = interaction.options.getChannel("channel", true);
    const msg = interaction.options.getString("message", true);

    s.welcomeChannelId = ch.id;
    s.welcomeMessage = msg;
    saveDB(db);

    return interaction.reply({ embeds: [E(`Welcome configured.\nChannel: <#${ch.id}>\nMessage: ${msg}`, "Settings")] });
  }

  // /prefix
  if (name === "prefix") {
    if (!hasPerm(member, PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Manage Server", "Error")] });
    }
    const p = interaction.options.getString("prefix", true);
    if (p.length > 3) return interaction.reply({ ephemeral: true, embeds: [E("Prefix too long. Use 1-3 characters.", "Error")] });

    s.prefix = p;
    saveDB(db);
    return interaction.reply({ embeds: [E(`Prefix updated to \`${p}\``, "Settings")] });
  }

  // /ping
  if (name === "ping") {
    return interaction.reply({ embeds: [E(`Latency: ${client.ws.ping}ms`, "Ping")] });
  }

  // /uptime
  if (name === "uptime") {
    return interaction.reply({ embeds: [E(uptimeStr(), "Uptime")] });
  }

  // /botinfo
  if (name === "botinfo") {
    const txt =
      `Tag: ${client.user.tag}\n` +
      `Servers: ${client.guilds.cache.size}\n` +
      `Uptime: ${uptimeStr()}`;
    return interaction.reply({ embeds: [E(txt, "Bot Info")] });
  }

  // /serverinfo
  if (name === "serverinfo") {
    const owner = await guild.fetchOwner().catch(() => null);
    const txt =
      `Name: ${guild.name}\n` +
      `ID: ${guild.id}\n` +
      `Owner: ${owner ? owner.user.tag : "Unknown"}\n` +
      `Members: ${guild.memberCount}\n` +
      `Boosts: ${guild.premiumSubscriptionCount || 0}\n` +
      `Created: ${guild.createdAt.toLocaleString()}`;
    return interaction.reply({ embeds: [E(txt, "Server Info")] });
  }

  // /userinfo
  if (name === "userinfo") {
    const u = interaction.options.getUser("user") || interaction.user;
    const m = await guild.members.fetch(u.id).catch(() => null);
    const roles = m ? m.roles.cache.filter(r => r.id !== guild.id).map(r => r.toString()).slice(0, 15).join(" ") : "—";
    const txt =
      `User: ${u.tag}\n` +
      `ID: ${u.id}\n` +
      `Created: ${u.createdAt.toLocaleString()}\n` +
      `Joined: ${m?.joinedAt ? m.joinedAt.toLocaleString() : "—"}\n` +
      `Roles: ${roles || "None"}`;
    return interaction.reply({ embeds: [E(txt, "User Info")] });
  }

  // /avatar
  if (name === "avatar") {
    const u = interaction.options.getUser("user") || interaction.user;
    return interaction.reply({ embeds: [E(u.displayAvatarURL({ size: 1024 }), "Avatar")] });
  }

  // /banner
  if (name === "banner") {
    const u = interaction.options.getUser("user") || interaction.user;
    const full = await u.fetch().catch(() => null);
    const url = full?.bannerURL({ size: 1024 }) || "No banner found.";
    return interaction.reply({ embeds: [E(url, "Banner")] });
  }

  // /poll
  if (name === "poll") {
    const q = interaction.options.getString("question", true);
    const msg = await interaction.reply({ embeds: [E(q, "Poll")], fetchReply: true });
    await msg.react("👍").catch(() => {});
    await msg.react("👎").catch(() => {});
    return;
  }

  // /afk
  if (name === "afk") {
    db.guilds[guild.id] ??= {};
    db.guilds[guild.id].afk ??= {};
    const msg = interaction.options.getString("message") || "AFK";
    db.guilds[guild.id].afk[interaction.user.id] = { msg, at: Date.now() };
    saveDB(db);
    return interaction.reply({ embeds: [E(`AFK set: ${msg}`, "AFK")], ephemeral: true });
  }

  // Leveling: /rank, /leaderboard, /setlevelchannel, /levelrole
  if (name === "setlevelchannel") {
    if (!hasPerm(member, PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Manage Server", "Error")] });
    }
    const ch = interaction.options.getChannel("channel", true);
    s.levelUpChannelId = ch.id;
    saveDB(db);
    return interaction.reply({ embeds: [E(`Level-up channel set to <#${ch.id}>`, "Leveling")] });
  }

  if (name === "levelrole") {
    if (!hasPerm(member, PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Manage Server", "Error")] });
    }
    const level = interaction.options.getInteger("level", true);
    const role = interaction.options.getRole("role", true);
    s.levelRoleRewards ??= [];
    // replace if existing
    s.levelRoleRewards = s.levelRoleRewards.filter(r => r.level !== level);
    s.levelRoleRewards.push({ level, roleId: role.id });
    saveDB(db);
    return interaction.reply({ embeds: [E(`Role reward set.\nLevel: **${level}** → Role: ${role}`, "Leveling")] });
  }

  if (name === "rank") {
    const u = interaction.options.getUser("user") || interaction.user;
    const data = lvlData(guild.id, u.id);
    const need = xpNeededFor(data.level);
    const txt =
      `User: <@${u.id}>\n` +
      `Level: **${data.level}**\n` +
      `XP: **${data.xp}**\n` +
      `Next Level XP Needed: **${need}**`;
    return interaction.reply({ embeds: [E(txt, "Rank")] });
  }

  if (name === "leaderboard") {
    const map = db.levels[guild.id] || {};
    const rows = Object.entries(map)
      .map(([uid, d]) => ({ uid, xp: d.xp, level: d.level }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10);

    if (rows.length === 0) {
      return interaction.reply({ embeds: [E("No leaderboard data yet. Chat more to gain XP.", "Leaderboard")] });
    }

    const lines = rows.map((r, i) => `#${i + 1} <@${r.uid}> • LVL: **${r.level}** • XP: **${r.xp}**`);
    return interaction.reply({ embeds: [E(lines.join("\n"), "Leaderboard")] });
  }

  // Moderation: /ban / unban / kick / timeout / warn / warnings / clearwarns / purge / lock / unlock / slowmode / nuke
  if (name === "warn") {
    if (!hasPerm(member, PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Moderate Members", "Error")] });
    }
    const u = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") || "No reason provided";
    addWarn(guild.id, u.id, { at: Date.now(), modId: interaction.user.id, reason });

    await interaction.reply({ embeds: [E(`<@${u.id}> has been warned.\nReason: ${reason}`, "Warn")] });
    await modlog(guild, `Action: Warn\nUser: ${u.tag} (${u.id})\nModerator: ${interaction.user.tag}\nReason: ${reason}`);
    return;
  }

  if (name === "warnings") {
    if (!hasPerm(member, PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Moderate Members", "Error")] });
    }
    const u = interaction.options.getUser("user", true);
    const list = getWarns(guild.id, u.id);
    if (list.length === 0) return interaction.reply({ embeds: [E(`<@${u.id}> has no warnings.`, "Warnings")] });

    const lines = list.slice(-10).map((w, i) => `${i + 1}. ${w.reason}`);
    return interaction.reply({ embeds: [E(`User: <@${u.id}>\nTotal: **${list.length}**\n\n${lines.join("\n")}`, "Warnings")] });
  }

  if (name === "clearwarns") {
    if (!hasPerm(member, PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Moderate Members", "Error")] });
    }
    const u = interaction.options.getUser("user", true);
    clearWarns(guild.id, u.id);
    await interaction.reply({ embeds: [E(`Warnings cleared for <@${u.id}>.`, "ClearWarns")] });
    await modlog(guild, `Action: ClearWarns\nUser: ${u.tag} (${u.id})\nModerator: ${interaction.user.tag}`);
    return;
  }

  if (name === "timeout") {
    if (!hasPerm(member, PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Moderate Members", "Error")] });
    }
    const u = interaction.options.getUser("user", true);
    const minutes = interaction.options.getInteger("minutes", true);
    const reason = interaction.options.getString("reason") || "No reason provided";
    const m = await guild.members.fetch(u.id).catch(() => null);
    if (!m) return interaction.reply({ ephemeral: true, embeds: [E("User not found in server.", "Error")] });

    await m.timeout(minutes * 60 * 1000, reason).catch(() => null);
    await interaction.reply({ embeds: [E(`<@${u.id}> has been timed out.\nDuration: ${minutes} minute(s)\nReason: ${reason}`, "Timeout")] });
    await modlog(guild, `Action: Timeout\nUser: ${u.tag} (${u.id})\nModerator: ${interaction.user.tag}\nMinutes: ${minutes}\nReason: ${reason}`);
    return;
  }

  if (name === "kick") {
    if (!hasPerm(member, PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Kick Members", "Error")] });
    }
    const u = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") || "No reason provided";
    const m = await guild.members.fetch(u.id).catch(() => null);
    if (!m || !m.kickable) return interaction.reply({ ephemeral: true, embeds: [E("Cannot kick (role hierarchy or missing permissions).", "Error")] });

    await m.kick(reason);
    await interaction.reply({ embeds: [E(`<@${u.id}> has been kicked.\nReason: ${reason}`, "Kick")] });
    await modlog(guild, `Action: Kick\nUser: ${u.tag} (${u.id})\nModerator: ${interaction.user.tag}\nReason: ${reason}`);
    return;
  }

  if (name === "ban") {
    if (!hasPerm(member, PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Ban Members", "Error")] });
    }
    const u = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") || "No reason provided";

    await guild.members.ban(u.id, { reason }).catch(() => null);
    await interaction.reply({ embeds: [E(`<@${u.id}> has been banned.\nReason: ${reason}`, "Ban")] });
    await modlog(guild, `Action: Ban\nUser: ${u.tag} (${u.id})\nModerator: ${interaction.user.tag}\nReason: ${reason}`);
    return;
  }

  if (name === "unban") {
    if (!hasPerm(member, PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Ban Members", "Error")] });
    }
    const uid = interaction.options.getString("userid", true);
    const reason = interaction.options.getString("reason") || "No reason provided";
    await guild.members.unban(uid, reason).catch(() => null);

    await interaction.reply({ embeds: [E(`Unbanned user ID: ${uid}\nReason: ${reason}`, "Unban")] });
    await modlog(guild, `Action: Unban\nUserID: ${uid}\nModerator: ${interaction.user.tag}\nReason: ${reason}`);
    return;
  }

  if (name === "purge") {
    if (!hasPerm(member, PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Manage Messages", "Error")] });
    }
    const amount = interaction.options.getInteger("amount", true);
    if (amount < 1 || amount > 100) {
      return interaction.reply({ ephemeral: true, embeds: [E("Amount must be 1-100.", "Error")] });
    }
    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
    const count = deleted ? deleted.size : 0;
    await interaction.reply({ embeds: [E(`Deleted ${count} message(s).`, "Purge")], ephemeral: true });
    await modlog(guild, `Action: Purge\nChannel: #${interaction.channel.name} (${interaction.channel.id})\nModerator: ${interaction.user.tag}\nDeleted: ${count}`);
    return;
  }

  if (name === "slowmode") {
    if (!hasPerm(member, PermissionsBitField.Flags.ManageChannels)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Manage Channels", "Error")] });
    }
    const seconds = interaction.options.getInteger("seconds", true);
    if (seconds < 0 || seconds > 21600) {
      return interaction.reply({ ephemeral: true, embeds: [E("Seconds must be 0-21600.", "Error")] });
    }
    await interaction.channel.setRateLimitPerUser(seconds).catch(() => null);
    return interaction.reply({ embeds: [E(`Slowmode set to ${seconds}s.`, "Slowmode")] });
  }

  if (name === "lock" || name === "unlock") {
    if (!hasPerm(member, PermissionsBitField.Flags.ManageChannels)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Manage Channels", "Error")] });
    }
    const allow = name === "unlock";
    const everyone = guild.roles.everyone;
    await interaction.channel.permissionOverwrites.edit(everyone, { SendMessages: allow }).catch(() => null);
    return interaction.reply({ embeds: [E(allow ? "Channel unlocked." : "Channel locked.", "Channel")] });
  }

  if (name === "nuke") {
    if (!hasPerm(member, PermissionsBitField.Flags.ManageChannels)) {
      return interaction.reply({ ephemeral: true, embeds: [E("Missing permission: Manage Channels", "Error")] });
    }
    const old = interaction.channel;
    const cloned = await old.clone().catch(() => null);
    if (!cloned) return interaction.reply({ ephemeral: true, embeds: [E("Failed to clone channel.", "Error")] });

    await old.delete().catch(() => null);
    // cannot reply after delete; so best effort:
    return;
  }
});

// =====================
// Start
// =====================
client.login(TOKEN);
