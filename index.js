// index.js (single-file command system)
// discord.js v14
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

// =====================
// ENV
// =====================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // Application ID
const GUILD_ID = process.env.GUILD_ID;   // Server ID (for fast dev register)
const DEFAULT_PREFIX = process.env.PREFIX || "?";

// =====================
// DB (data.json)
// =====================
const DB_FILE = path.join(__dirname, "data.json");

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const db = JSON.parse(raw);
    db.guilds ??= {};
    db.warnings ??= {};
    db.levels ??= {};
    db.economy ??= {};
    return db;
  } catch {
    const db = { guilds: {}, warnings: {}, levels: {}, economy: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
}

let DB = loadDB();

function ensureGuild(guildId) {
  DB.guilds[guildId] ??= {
    prefix: DEFAULT_PREFIX,
    modlogChannelId: null
  };
  return DB.guilds[guildId];
}

function getPrefix(guildId) {
  const g = ensureGuild(guildId);
  return g.prefix || DEFAULT_PREFIX;
}

function setPrefix(guildId, p) {
  const g = ensureGuild(guildId);
  g.prefix = p;
  saveDB();
}

function getModlogChannelId(guildId) {
  const g = ensureGuild(guildId);
  return g.modlogChannelId || null;
}

function setModlogChannelId(guildId, channelId) {
  const g = ensureGuild(guildId);
  g.modlogChannelId = channelId;
  saveDB();
}

// ---------------------
// Warnings storage
// ---------------------
function ensureWarns(guildId) {
  DB.warnings[guildId] ??= {};
  return DB.warnings[guildId];
}

function addWarn(guildId, userId, reason, moderatorId) {
  const gw = ensureWarns(guildId);
  gw[userId] ??= [];
  const list = gw[userId];
  const item = {
    reason: reason || "No reason",
    mod: moderatorId || null,
    at: Date.now()
  };
  list.push(item);
  saveDB();
  return list;
}

function getWarns(guildId, userId) {
  const gw = ensureWarns(guildId);
  return gw[userId] ?? [];
}

function clearWarns(guildId, userId) {
  const gw = ensureWarns(guildId);
  gw[userId] = [];
  saveDB();
  return [];
}

// ---------------------
// Economy storage
// ---------------------
function ensureEco(guildId, userId) {
  DB.economy[guildId] ??= {};
  DB.economy[guildId][userId] ??= { wallet: 0, bank: 0, lastDaily: 0, lastWork: 0 };
  return DB.economy[guildId][userId];
}
function money(n) {
  return `${n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function now() {
  return Date.now();
}
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// =====================
// EMBEDS (dark yellow theme)
// =====================
const DARK_YELLOW = 0xD4A017;

function embed(desc, title = null) {
  const e = new EmbedBuilder().setColor(DARK_YELLOW).setDescription(desc);
  if (title) e.setTitle(title);
  return e;
}

function errorEmbed(desc) {
  return new EmbedBuilder().setColor(0xE74C3C).setDescription(desc);
}

// =====================
// DISCORD CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

// =====================
// Helpers
// =====================
async function resolveMemberFromText(guild, text) {
  if (!text) return null;

  // mention <@123> or <@!123>
  const mentionMatch = text.match(/^<@!?(\d+)>$/);
  const id = mentionMatch ? mentionMatch[1] : (text.match(/^\d+$/) ? text : null);
  if (!id) return null;

  try {
    return await guild.members.fetch(id);
  } catch {
    return null;
  }
}

function hasPerm(member, perm) {
  return member.permissions.has(perm);
}

async function sendModlog(guild, contentEmbeds) {
  const modlogId = getModlogChannelId(guild.id) || process.env.MODLOG_CHANNEL_ID || null;
  if (!modlogId) return;
  const ch = guild.channels.cache.get(modlogId);
  if (!ch) return;
  try {
    await ch.send({ embeds: contentEmbeds });
  } catch {}
}

function formatDurationMin(mins) {
  const m = Number(mins);
  if (!Number.isFinite(m) || m <= 0) return null;
  return m * 60 * 1000;
}

// =====================
// Command Registry (FUTURE-PROOF)
// Add new command by adding one object here.
// It auto supports: prefix + slash (if slashBuilder exists)
// =====================
const COMMANDS = [
  // ========= HELP / COMMANDS =========
  {
    name: "commands",
    description: "Show command list.",
    aliases: ["help"],
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("commands")
        .setDescription("Show command list."),
    run: async (ctx) => {
      const lines = [
        "**Moderation**",
        "`ban` `unban` `kick` `timeout` `warn` `warnings` `clearwarns` `purge` `lock` `unlock` `slowmode` `nuke`",
        "",
        "**Utility**",
        "`ping` `userinfo` `serverinfo` `avatar` `uptime` `invite` `setmodlog` `prefix`",
        "",
        "**Economy**",
        "`daily` `work` `balance` `beg` `pay` `gamble`",
        "",
        "**Games**",
        "`coinflip` `dice` `8ball` `rate` `ship` `joke`"
      ].join("\n");

      return ctx.reply({ embeds: [embed(lines, "Commands")] });
    }
  },

  // ========= CONFIG =========
  {
    name: "prefix",
    description: "Change the command prefix.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("prefix")
        .setDescription("Change the command prefix.")
        .addStringOption(o => o.setName("prefix").setDescription("Example: ? or !").setRequired(true)),
    run: async (ctx) => {
      const g = ctx.guild;
      const member = ctx.member;

      if (!hasPerm(member, PermissionsBitField.Flags.ManageGuild)) {
        return ctx.reply({ embeds: [errorEmbed("You need Manage Server permission.")], ephemeral: true });
      }

      const p = ctx.getString("prefix");
      if (!p || p.length > 3) {
        return ctx.reply({ embeds: [errorEmbed("Prefix must be 1-3 characters.")], ephemeral: true });
      }
      setPrefix(g.id, p);
      return ctx.reply({ embeds: [embed(`Prefix set to \`${p}\`.`, "Prefix")] });
    }
  },
  {
    name: "setmodlog",
    description: "Set modlog channel.",
    aliases: ["modlog"],
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("setmodlog")
        .setDescription("Set modlog channel.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Select a text channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        ),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ManageGuild)) {
        return ctx.reply({ embeds: [errorEmbed("You need Manage Server permission.")], ephemeral: true });
      }
      const ch = ctx.getChannel("channel");
      setModlogChannelId(ctx.guild.id, ch.id);
      return ctx.reply({ embeds: [embed(`Mod logs channel set to ${ch}.`, "Mod Logs")] });
    }
  },

  // ========= MODERATION =========
  {
    name: "warn",
    description: "Warn a member (saved in database).",
    aliases: [],
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Warn a member (saved in database).")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ModerateMembers)) {
        return ctx.reply({ embeds: [errorEmbed("You need Moderate Members permission.")], ephemeral: true });
      }

      const targetText = ctx.getString("user");
      const reason = ctx.getString("reason") || "No reason";

      const target = await resolveMemberFromText(ctx.guild, targetText);
      if (!target) {
        return ctx.reply({ embeds: [errorEmbed("User not found. Use mention or User ID.")], ephemeral: true });
      }
      if (target.id === ctx.member.id) {
        return ctx.reply({ embeds: [errorEmbed("You can’t warn yourself.")], ephemeral: true });
      }
      if (target.user.bot) {
        return ctx.reply({ embeds: [errorEmbed("You can’t warn a bot.")], ephemeral: true });
      }

      const warns = addWarn(ctx.guild.id, target.id, reason, ctx.user.id);

      await ctx.reply({
        embeds: [embed(`✅ ${target} has been warned.\nReason: **${reason}**\nTotal warnings: **${warns.length}**`, "Warn")]
      });

      await sendModlog(ctx.guild, [
        embed(`Action: **Warn**\nUser: ${target} (${target.id})\nModerator: <@${ctx.user.id}>\nReason: **${reason}**\nTotal: **${warns.length}**`, "Mod Log")
      ]);
    }
  },
  {
    name: "warnings",
    description: "Show warnings of a user.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("warnings")
        .setDescription("Show warnings of a user.")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(true)),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ModerateMembers)) {
        return ctx.reply({ embeds: [errorEmbed("You need Moderate Members permission.")], ephemeral: true });
      }
      const targetText = ctx.getString("user");
      const target = await resolveMemberFromText(ctx.guild, targetText);
      if (!target) {
        return ctx.reply({ embeds: [errorEmbed("User not found. Use mention or User ID.")], ephemeral: true });
      }

      const warns = getWarns(ctx.guild.id, target.id);
      if (!warns.length) {
        return ctx.reply({ embeds: [embed(`${target} has no warnings.`, "Warnings")] });
      }

      const list = warns
        .slice(-10)
        .map((w, i) => `**${i + 1}.** ${w.reason} • <@${w.mod || "0"}>`);

      return ctx.reply({
        embeds: [embed(`User: ${target}\nTotal: **${warns.length}**\n\n${list.join("\n")}`, "Warnings")]
      });
    }
  },
  {
    name: "clearwarns",
    description: "Clear all warnings of a user.",
    aliases: ["clearwarnings"],
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("clearwarns")
        .setDescription("Clear all warnings of a user.")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(true)),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ModerateMembers)) {
        return ctx.reply({ embeds: [errorEmbed("You need Moderate Members permission.")], ephemeral: true });
      }
      const targetText = ctx.getString("user");
      const target = await resolveMemberFromText(ctx.guild, targetText);
      if (!target) {
        return ctx.reply({ embeds: [errorEmbed("User not found. Use mention or User ID.")], ephemeral: true });
      }

      clearWarns(ctx.guild.id, target.id);

      await ctx.reply({ embeds: [embed(`Warnings cleared for ${target}.`, "Clear Warns")] });

      await sendModlog(ctx.guild, [
        embed(`Action: **Clear Warns**\nUser: ${target} (${target.id})\nModerator: <@${ctx.user.id}>`, "Mod Log")
      ]);
    }
  },
  {
    name: "kick",
    description: "Kick a user.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kick a user.")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.KickMembers)) {
        return ctx.reply({ embeds: [errorEmbed("You need Kick Members permission.")], ephemeral: true });
      }
      const targetText = ctx.getString("user");
      const reason = ctx.getString("reason") || "No reason";

      const target = await resolveMemberFromText(ctx.guild, targetText);
      if (!target) return ctx.reply({ embeds: [errorEmbed("User not found. Use mention or User ID.")], ephemeral: true });

      if (!target.kickable) return ctx.reply({ embeds: [errorEmbed("I can’t kick that user (role hierarchy).")], ephemeral: true });

      await target.kick(reason);

      await ctx.reply({ embeds: [embed(`✅ ${target.user.tag} has been kicked.\nReason: **${reason}**`, "Kick")] });

      await sendModlog(ctx.guild, [
        embed(`Action: **Kick**\nUser: ${target} (${target.id})\nModerator: <@${ctx.user.id}>\nReason: **${reason}**`, "Mod Log")
      ]);
    }
  },
  {
    name: "ban",
    description: "Ban a user.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a user.")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.BanMembers)) {
        return ctx.reply({ embeds: [errorEmbed("You need Ban Members permission.")], ephemeral: true });
      }
      const targetText = ctx.getString("user");
      const reason = ctx.getString("reason") || "No reason";

      const target = await resolveMemberFromText(ctx.guild, targetText);
      if (!target) return ctx.reply({ embeds: [errorEmbed("User not found. Use mention or User ID.")], ephemeral: true });

      if (!target.bannable) return ctx.reply({ embeds: [errorEmbed("I can’t ban that user (role hierarchy).")], ephemeral: true });

      await target.ban({ reason });

      await ctx.reply({ embeds: [embed(`✅ ${target.user.tag} has been banned.\nReason: **${reason}**`, "Ban")] });

      await sendModlog(ctx.guild, [
        embed(`Action: **Ban**\nUser: ${target} (${target.id})\nModerator: <@${ctx.user.id}>\nReason: **${reason}**`, "Mod Log")
      ]);
    }
  },
  {
    name: "unban",
    description: "Unban a user by ID.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("unban")
        .setDescription("Unban a user by ID.")
        .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.BanMembers)) {
        return ctx.reply({ embeds: [errorEmbed("You need Ban Members permission.")], ephemeral: true });
      }
      const userId = ctx.getString("userid");
      const reason = ctx.getString("reason") || "No reason";
      if (!/^\d+$/.test(userId)) return ctx.reply({ embeds: [errorEmbed("Invalid User ID.")], ephemeral: true });

      try {
        await ctx.guild.members.unban(userId, reason);
        await ctx.reply({ embeds: [embed(`✅ Unbanned user ID: **${userId}**`, "Unban")] });

        await sendModlog(ctx.guild, [
          embed(`Action: **Unban**\nUser ID: **${userId}**\nModerator: <@${ctx.user.id}>\nReason: **${reason}**`, "Mod Log")
        ]);
      } catch {
        return ctx.reply({ embeds: [errorEmbed("That user is not banned or ID is wrong.")], ephemeral: true });
      }
    }
  },
  {
    name: "timeout",
    description: "Timeout a user.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("timeout")
        .setDescription("Timeout a user.")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(true))
        .addIntegerOption(o => o.setName("minutes").setDescription("Minutes").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ModerateMembers)) {
        return ctx.reply({ embeds: [errorEmbed("You need Moderate Members permission.")], ephemeral: true });
      }
      const targetText = ctx.getString("user");
      const mins = ctx.getInt("minutes");
      const reason = ctx.getString("reason") || "No reason";

      const target = await resolveMemberFromText(ctx.guild, targetText);
      if (!target) return ctx.reply({ embeds: [errorEmbed("User not found. Use mention or User ID.")], ephemeral: true });

      const ms = formatDurationMin(mins);
      if (!ms) return ctx.reply({ embeds: [errorEmbed("Minutes must be a number > 0.")], ephemeral: true });

      try {
        await target.timeout(ms, reason);
        await ctx.reply({ embeds: [embed(`✅ ${target} has been timed out for **${mins} minutes**.\nReason: **${reason}**`, "Timeout")] });

        await sendModlog(ctx.guild, [
          embed(`Action: **Timeout**\nUser: ${target} (${target.id})\nModerator: <@${ctx.user.id}>\nDuration: **${mins} minutes**\nReason: **${reason}**`, "Mod Log")
        ]);
      } catch {
        return ctx.reply({ embeds: [errorEmbed("I can’t timeout that user (role hierarchy / missing perms).")], ephemeral: true });
      }
    }
  },
  {
    name: "untimeout",
    description: "Remove timeout from a user.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("untimeout")
        .setDescription("Remove timeout from a user.")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ModerateMembers)) {
        return ctx.reply({ embeds: [errorEmbed("You need Moderate Members permission.")], ephemeral: true });
      }
      const targetText = ctx.getString("user");
      const reason = ctx.getString("reason") || "No reason";

      const target = await resolveMemberFromText(ctx.guild, targetText);
      if (!target) return ctx.reply({ embeds: [errorEmbed("User not found. Use mention or User ID.")], ephemeral: true });

      try {
        await target.timeout(null, reason);
        await ctx.reply({ embeds: [embed(`✅ Timeout removed for ${target}.`, "Untimeout")] });

        await sendModlog(ctx.guild, [
          embed(`Action: **Untimeout**\nUser: ${target} (${target.id})\nModerator: <@${ctx.user.id}>\nReason: **${reason}**`, "Mod Log")
        ]);
      } catch {
        return ctx.reply({ embeds: [errorEmbed("I can’t remove timeout for that user.")], ephemeral: true });
      }
    }
  },
  {
    name: "purge",
    description: "Bulk delete messages.",
    aliases: ["clear"],
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("purge")
        .setDescription("Bulk delete messages.")
        .addIntegerOption(o => o.setName("amount").setDescription("1-100").setRequired(true)),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ManageMessages)) {
        return ctx.reply({ embeds: [errorEmbed("You need Manage Messages permission.")], ephemeral: true });
      }
      const amount = ctx.getInt("amount");
      if (amount < 1 || amount > 100) {
        return ctx.reply({ embeds: [errorEmbed("Amount must be between 1 and 100.")], ephemeral: true });
      }

      const channel = ctx.channel;
      try {
        await channel.bulkDelete(amount, true);
      } catch {
        return ctx.reply({ embeds: [errorEmbed("I couldn’t delete messages (maybe too old).")], ephemeral: true });
      }

      return ctx.reply({ embeds: [embed(`✅ Deleted **${amount}** messages.`, "Purge")] }).then(m => {
        setTimeout(() => m.delete().catch(() => {}), 3000);
      });
    }
  },
  {
    name: "slowmode",
    description: "Set slowmode in channel.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("slowmode")
        .setDescription("Set slowmode in channel.")
        .addIntegerOption(o => o.setName("seconds").setDescription("0-21600").setRequired(true)),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ManageChannels)) {
        return ctx.reply({ embeds: [errorEmbed("You need Manage Channels permission.")], ephemeral: true });
      }
      const sec = ctx.getInt("seconds");
      if (sec < 0 || sec > 21600) {
        return ctx.reply({ embeds: [errorEmbed("Seconds must be 0 to 21600.")], ephemeral: true });
      }
      await ctx.channel.setRateLimitPerUser(sec);
      return ctx.reply({ embeds: [embed(`Slowmode set to **${sec}s** in ${ctx.channel}.`, "Slowmode")] });
    }
  },
  {
    name: "lock",
    description: "Lock current channel.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("lock")
        .setDescription("Lock current channel."),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ManageChannels)) {
        return ctx.reply({ embeds: [errorEmbed("You need Manage Channels permission.")], ephemeral: true });
      }
      await ctx.channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: false });
      return ctx.reply({ embeds: [embed(`Channel locked: ${ctx.channel}`, "Lock")] });
    }
  },
  {
    name: "unlock",
    description: "Unlock current channel.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("unlock")
        .setDescription("Unlock current channel."),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ManageChannels)) {
        return ctx.reply({ embeds: [errorEmbed("You need Manage Channels permission.")], ephemeral: true });
      }
      await ctx.channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: null });
      return ctx.reply({ embeds: [embed(`Channel unlocked: ${ctx.channel}`, "Unlock")] });
    }
  },
  {
    name: "nuke",
    description: "Clone and delete channel (clear history).",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("nuke")
        .setDescription("Clone and delete channel (clear history)."),
    run: async (ctx) => {
      if (!hasPerm(ctx.member, PermissionsBitField.Flags.ManageChannels)) {
        return ctx.reply({ embeds: [errorEmbed("You need Manage Channels permission.")], ephemeral: true });
      }
      const ch = ctx.channel;
      const clone = await ch.clone();
      await clone.setPosition(ch.position);
      await ch.delete().catch(() => {});
      return clone.send({ embeds: [embed("Channel nuked.", "Nuke")] });
    }
  },

  // ========= UTILITY =========
  {
    name: "ping",
    description: "Check bot latency.",
    slashBuilder: () => new SlashCommandBuilder().setName("ping").setDescription("Check bot latency."),
    run: async (ctx) => {
      const ws = Math.round(client.ws.ping);
      return ctx.reply({ embeds: [embed(`Latency: **${ws}ms**`, "Ping")] });
    }
  },
  {
    name: "serverinfo",
    description: "Show server info.",
    slashBuilder: () => new SlashCommandBuilder().setName("serverinfo").setDescription("Show server info."),
    run: async (ctx) => {
      const g = ctx.guild;
      const text = [
        `Name: **${g.name}**`,
        `Members: **${g.memberCount}**`,
        `Owner: <@${g.ownerId}>`,
        `Created: <t:${Math.floor(g.createdTimestamp / 1000)}:D>`
      ].join("\n");
      return ctx.reply({ embeds: [embed(text, "Server Info")] });
    }
  },
  {
    name: "userinfo",
    description: "Show user info.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("userinfo")
        .setDescription("Show user info.")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(false)),
    run: async (ctx) => {
      const t = ctx.getString("user");
      const member = t ? await resolveMemberFromText(ctx.guild, t) : ctx.member;

      if (!member) return ctx.reply({ embeds: [errorEmbed("User not found.")], ephemeral: true });

      const roles = member.roles.cache
        .filter(r => r.id !== ctx.guild.id)
        .map(r => r.toString())
        .slice(0, 20);

      const text = [
        `User: ${member} (${member.id})`,
        `Created: <t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`,
        `Joined: <t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,
        `Roles: ${roles.length ? roles.join(" ") : "None"}`
      ].join("\n");

      return ctx.reply({ embeds: [embed(text, "User Info")] });
    }
  },
  {
    name: "avatar",
    description: "Show user avatar.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("avatar")
        .setDescription("Show user avatar.")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(false)),
    run: async (ctx) => {
      const t = ctx.getString("user");
      const member = t ? await resolveMemberFromText(ctx.guild, t) : ctx.member;
      if (!member) return ctx.reply({ embeds: [errorEmbed("User not found.")], ephemeral: true });

      const url = member.user.displayAvatarURL({ size: 2048 });
      const e = embed(`User: ${member}`, "Avatar").setImage(url);
      return ctx.reply({ embeds: [e] });
    }
  },
  {
    name: "uptime",
    description: "Bot uptime.",
    slashBuilder: () => new SlashCommandBuilder().setName("uptime").setDescription("Bot uptime."),
    run: async (ctx) => {
      const s = Math.floor(process.uptime());
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return ctx.reply({ embeds: [embed(`Uptime: **${h}h ${m}m ${sec}s**`, "Uptime")] });
    }
  },
  {
    name: "invite",
    description: "Bot invite link.",
    slashBuilder: () => new SlashCommandBuilder().setName("invite").setDescription("Bot invite link."),
    run: async (ctx) => {
      const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID || "YOUR_CLIENT_ID"}&scope=bot%20applications.commands&permissions=8`;
      return ctx.reply({ embeds: [embed(`Invite: ${url}`, "Invite")] });
    }
  },

  // ========= ECONOMY =========
  {
    name: "balance",
    description: "Check wallet/bank.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("balance")
        .setDescription("Check wallet/bank.")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(false)),
    run: async (ctx) => {
      const t = ctx.getString("user");
      const member = t ? await resolveMemberFromText(ctx.guild, t) : ctx.member;
      if (!member) return ctx.reply({ embeds: [errorEmbed("User not found.")], ephemeral: true });

      const d = ensureEco(ctx.guild.id, member.id);
      saveDB();

      return ctx.reply({
        embeds: [embed(`User: ${member}\nWallet: **${money(d.wallet)}**\nBank: **${money(d.bank)}**`, "Balance")]
      });
    }
  },
  {
    name: "daily",
    description: "Claim daily coins (24h cooldown).",
    slashBuilder: () => new SlashCommandBuilder().setName("daily").setDescription("Claim daily coins (24h cooldown)."),
    run: async (ctx) => {
      const d = ensureEco(ctx.guild.id, ctx.user.id);
      const cooldown = 24 * 60 * 60 * 1000;
      if (now() - d.lastDaily < cooldown) {
        const left = Math.ceil((cooldown - (now() - d.lastDaily)) / (60 * 1000));
        return ctx.reply({ embeds: [errorEmbed(`Daily already claimed. Try again in **${left} min**.`)], ephemeral: true });
      }
      const amount = rand(150, 350);
      d.wallet += amount;
      d.lastDaily = now();
      saveDB();
      return ctx.reply({ embeds: [embed(`You claimed **${money(amount)}** coins.\nWallet: **${money(d.wallet)}**`, "Daily")] });
    }
  },
  {
    name: "work",
    description: "Work for coins (30m cooldown).",
    slashBuilder: () => new SlashCommandBuilder().setName("work").setDescription("Work for coins (30m cooldown)."),
    run: async (ctx) => {
      const d = ensureEco(ctx.guild.id, ctx.user.id);
      const cooldown = 30 * 60 * 1000;
      if (now() - d.lastWork < cooldown) {
        const left = Math.ceil((cooldown - (now() - d.lastWork)) / (60 * 1000));
        return ctx.reply({ embeds: [errorEmbed(`Work cooldown. Try again in **${left} min**.`)], ephemeral: true });
      }
      const jobs = ["Cashier", "Helper", "Delivery", "Editor", "Encoder", "Crew"];
      const job = jobs[rand(0, jobs.length - 1)];
      const amount = rand(80, 220);
      d.wallet += amount;
      d.lastWork = now();
      saveDB();
      return ctx.reply({ embeds: [embed(`You worked as **${job}** and earned **${money(amount)}** coins.\nWallet: **${money(d.wallet)}**`, "Work")] });
    }
  },
  {
    name: "beg",
    description: "Ask for spare coins.",
    slashBuilder: () => new SlashCommandBuilder().setName("beg").setDescription("Ask for spare coins."),
    run: async (ctx) => {
      const d = ensureEco(ctx.guild.id, ctx.user.id);
      const amount = rand(0, 120);
      const ok = amount > 10;
      if (ok) d.wallet += amount;
      saveDB();
      return ctx.reply({ embeds: [embed(ok ? `Someone gave you **${money(amount)}** coins.` : `No one gave you anything.`, "Beg")] });
    }
  },
  {
    name: "pay",
    description: "Pay coins to another user.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("pay")
        .setDescription("Pay coins to another user.")
        .addStringOption(o => o.setName("user").setDescription("Mention or User ID").setRequired(true))
        .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)),
    run: async (ctx) => {
      const t = ctx.getString("user");
      const amount = ctx.getInt("amount");
      const target = await resolveMemberFromText(ctx.guild, t);
      if (!target) return ctx.reply({ embeds: [errorEmbed("User not found. Use mention or User ID.")], ephemeral: true });
      if (target.user.bot) return ctx.reply({ embeds: [errorEmbed("You can’t pay a bot.")], ephemeral: true });
      if (amount <= 0) return ctx.reply({ embeds: [errorEmbed("Amount must be greater than 0.")], ephemeral: true });

      const sender = ensureEco(ctx.guild.id, ctx.user.id);
      const recv = ensureEco(ctx.guild.id, target.id);

      if (sender.wallet < amount) return ctx.reply({ embeds: [errorEmbed("Not enough coins in wallet.")], ephemeral: true });

      sender.wallet -= amount;
      recv.wallet += amount;
      saveDB();

      return ctx.reply({ embeds: [embed(`Transferred **${money(amount)}** coins to ${target}.`, "Pay")] });
    }
  },
  {
    name: "gamble",
    description: "Gamble coins.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("gamble")
        .setDescription("Gamble coins.")
        .addIntegerOption(o => o.setName("amount").setDescription("Bet amount").setRequired(true)),
    run: async (ctx) => {
      const bet = ctx.getInt("amount");
      const d = ensureEco(ctx.guild.id, ctx.user.id);
      if (bet <= 0) return ctx.reply({ embeds: [errorEmbed("Bet must be greater than 0.")], ephemeral: true });
      if (d.wallet < bet) return ctx.reply({ embeds: [errorEmbed("Not enough coins in wallet.")], ephemeral: true });

      const win = Math.random() < 0.45;
      if (win) {
        d.wallet += bet;
        saveDB();
        return ctx.reply({ embeds: [embed(`You won. +**${money(bet)}** coins.\nWallet: **${money(d.wallet)}**`, "Gamble")] });
      } else {
        d.wallet -= bet;
        saveDB();
        return ctx.reply({ embeds: [embed(`You lost. -**${money(bet)}** coins.\nWallet: **${money(d.wallet)}**`, "Gamble")] });
      }
    }
  },

  // ========= GAMES =========
  {
    name: "coinflip",
    description: "Flip a coin.",
    slashBuilder: () => new SlashCommandBuilder().setName("coinflip").setDescription("Flip a coin."),
    run: async (ctx) => {
      const res = Math.random() < 0.5 ? "Heads" : "Tails";
      return ctx.reply({ embeds: [embed(`Result: **${res}**`, "Coinflip")] });
    }
  },
  {
    name: "dice",
    description: "Roll a dice.",
    slashBuilder: () => new SlashCommandBuilder().setName("dice").setDescription("Roll a dice."),
    run: async (ctx) => {
      const roll = rand(1, 6);
      return ctx.reply({ embeds: [embed(`You rolled: **${roll}**`, "Dice")] });
    }
  },
  {
    name: "8ball",
    description: "Ask the magic 8ball.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("8ball")
        .setDescription("Ask the magic 8ball.")
        .addStringOption(o => o.setName("question").setDescription("Question").setRequired(true)),
    run: async (ctx) => {
      const q = ctx.getString("question");
      const answers = ["Yes", "No", "Maybe", "Likely", "Unlikely", "Ask again later"];
      const a = answers[rand(0, answers.length - 1)];
      return ctx.reply({ embeds: [embed(`Question: ${q}\nAnswer: **${a}**`, "8ball")] });
    }
  },
  {
    name: "rate",
    description: "Rate something 0-10.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("rate")
        .setDescription("Rate something 0-10.")
        .addStringOption(o => o.setName("text").setDescription("Text").setRequired(true)),
    run: async (ctx) => {
      const text = ctx.getString("text");
      const score = rand(0, 10);
      return ctx.reply({ embeds: [embed(`"${text}"\nRating: **${score}/10**`, "Rate")] });
    }
  },
  {
    name: "ship",
    description: "Ship two users.",
    slashBuilder: () =>
      new SlashCommandBuilder()
        .setName("ship")
        .setDescription("Ship two users.")
        .addStringOption(o => o.setName("user1").setDescription("Mention or User ID").setRequired(true))
        .addStringOption(o => o.setName("user2").setDescription("Mention or User ID").setRequired(true)),
    run: async (ctx) => {
      const u1t = ctx.getString("user1");
      const u2t = ctx.getString("user2");
      const u1 = await resolveMemberFromText(ctx.guild, u1t);
      const u2 = await resolveMemberFromText(ctx.guild, u2t);
      if (!u1 || !u2) return ctx.reply({ embeds: [errorEmbed("User not found. Use mention or User ID.")], ephemeral: true });

      const score = rand(0, 100);
      return ctx.reply({ embeds: [embed(`${u1} + ${u2}\nCompatibility: **${score}%**`, "Ship")] });
    }
  },
  {
    name: "joke",
    description: "Random joke.",
    slashBuilder: () => new SlashCommandBuilder().setName("joke").setDescription("Random joke."),
    run: async (ctx) => {
      const jokes = [
        "I told my computer I needed a break, now it won’t stop sending me KitKats.",
        "Why did the math book look sad? It had too many problems.",
        "I tried to catch fog… I mist.",
        "Parallel lines have so much in common. It’s a shame they’ll never meet."
      ];
      return ctx.reply({ embeds: [embed(jokes[rand(0, jokes.length - 1)], "Joke")] });
    }
  }
];

// =====================
// Build lookup maps
// =====================
const byName = new Map();
const byAlias = new Map();

for (const c of COMMANDS) {
  byName.set(c.name, c);
  if (c.aliases) {
    for (const a of c.aliases) byAlias.set(a, c.name);
  }
}

// =====================
// Unified Context
// =====================
function makeCtxFromInteraction(interaction) {
  return {
    type: "slash",
    guild: interaction.guild,
    channel: interaction.channel,
    member: interaction.member,
    user: interaction.user,
    reply: (payload) => interaction.reply(payload),
    getString: (name) => interaction.options.getString(name),
    getInt: (name) => interaction.options.getInteger(name),
    getChannel: (name) => interaction.options.getChannel(name)
  };
}

function makeCtxFromMessage(message, args) {
  return {
    type: "prefix",
    guild: message.guild,
    channel: message.channel,
    member: message.member,
    user: message.author,
    reply: (payload) => message.channel.send(payload),
    // for prefix commands we treat first arg as "user" etc via helper:
    getString: (name) => {
      if (name === "user" || name === "userid") return args[0] || null;
      if (name === "reason") return args.slice(1).join(" ") || null;
      if (name === "prefix") return args[0] || null;
      if (name === "question") return args.join(" ") || null;
      if (name === "text") return args.join(" ") || null;
      if (name === "user1") return args[0] || null;
      if (name === "user2") return args[1] || null;
      return null;
    },
    getInt: (name) => {
      if (name === "amount" || name === "minutes" || name === "seconds") {
        const n = Number(args[0]);
        return Number.isFinite(n) ? Math.floor(n) : null;
      }
      return null;
    },
    getChannel: () => null
  };
}

// =====================
// Slash registration
// =====================
async function registerSlash() {
  if (!CLIENT_ID || !GUILD_ID) {
    console.log("Slash commands not registered (missing CLIENT_ID or GUILD_ID).");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const slashJSON = COMMANDS
    .filter(c => typeof c.slashBuilder === "function")
    .map(c => c.slashBuilder().toJSON());

  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: slashJSON });
    console.log("Slash commands registered.");
  } catch (e) {
    console.log("Slash register error:", e?.message || e);
  }
}

// =====================
// Events
// =====================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerSlash();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmdName = interaction.commandName;
  const c = byName.get(cmdName);
  if (!c) return;

  try {
    const ctx = makeCtxFromInteraction(interaction);
    await c.run(ctx);
  } catch (e) {
    try {
      if (!interaction.replied) {
        await interaction.reply({ embeds: [errorEmbed("Something went wrong while running that command.")], ephemeral: true });
      }
    } catch {}
    console.log("Command error:", e);
  }
});

client.on("messageCreate", async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const prefix = getPrefix(message.guild.id);
  if (!message.content.startsWith(prefix)) return;

  const raw = message.content.slice(prefix.length).trim();
  if (!raw) return;

  const parts = raw.split(/\s+/);
  const name = parts.shift().toLowerCase();
  const args = parts;

  const resolved = byAlias.get(name) || name;
  const c = byName.get(resolved);
  if (!c) return;

  // allow prefix commands only for commands that exist in registry
  try {
    const ctx = makeCtxFromMessage(message, args);

    // small compatibility for prefix versions:
    // If command needs a channel option in slash (setmodlog), prefix version expects #channel mention
    if (c.name === "setmodlog") {
      const ch = message.mentions.channels.first();
      if (!ch) {
        return message.channel.send({ embeds: [errorEmbed(`Usage: ${prefix}setmodlog #channel`)] });
      }
      ctx.getChannel = () => ch;
    }

    // purge prefix uses amount
    if (c.name === "purge") {
      ctx.getInt = () => {
        const n = Number(args[0]);
        return Number.isFinite(n) ? Math.floor(n) : null;
      };
    }

    // slowmode prefix uses seconds
    if (c.name === "slowmode") {
      ctx.getInt = () => {
        const n = Number(args[0]);
        return Number.isFinite(n) ? Math.floor(n) : null;
      };
    }

    // timeout prefix expects: ?timeout <@id|id> <minutes> (reason)
    if (c.name === "timeout") {
      ctx.getString = (field) => {
        if (field === "user") return args[0] || null;
        if (field === "reason") return args.slice(2).join(" ") || null;
        return null;
      };
      ctx.getInt = (field) => {
        if (field === "minutes") {
          const n = Number(args[1]);
          return Number.isFinite(n) ? Math.floor(n) : null;
        }
        return null;
      };
    }

    // pay prefix: ?pay <@id|id> <amount>
    if (c.name === "pay") {
      ctx.getString = (field) => (field === "user" ? args[0] : null);
      ctx.getInt = (field) => {
        if (field === "amount") {
          const n = Number(args[1]);
          return Number.isFinite(n) ? Math.floor(n) : null;
        }
        return null;
      };
    }

    // gamble prefix: ?gamble <amount>
    if (c.name === "gamble") {
      ctx.getInt = () => {
        const n = Number(args[0]);
        return Number.isFinite(n) ? Math.floor(n) : null;
      };
    }

    await c.run(ctx);
  } catch (e) {
    console.log("Prefix command error:", e);
  }
});

// =====================
client.login(TOKEN);
