const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  Events,
  ChannelType,
} = require("discord.js");

const {
  nextCase,
  addWarning, getWarnings, clearWarnings,
  setAFK, getAFK, clearAFK,
  setSticky, getSticky, removeSticky, setStickyLastId
} = require("./db");

const PREFIX = process.env.PREFIX || "?";
const MODLOG_CHANNEL_ID = process.env.MODLOG_CHANNEL_ID || null;
const SUGGEST_CHANNEL_ID = process.env.SUGGEST_CHANNEL_ID || null;
const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID || null;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null;

const CLIENT_ID = process.env.CLIENT_ID || null;

const YELLOW = 0xFEE75C;
const startedAt = Date.now();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

function embed(desc, title = null) {
  const em = new EmbedBuilder().setColor(YELLOW).setDescription(desc).setTimestamp();
  if (title) em.setTitle(title);
  return em;
}

function usage(cmd, desc, use) {
  return new EmbedBuilder()
    .setColor(YELLOW)
    .setTitle(cmd)
    .setDescription(desc)
    .addFields({ name: "Usage", value: use })
    .setTimestamp();
}

function hasPerm(member, perm) {
  return member?.permissions?.has(perm);
}

function parseIdOrMention(raw) {
  if (!raw) return null;
  const m = raw.match(/^<@!?(\d+)>$/);
  if (m) return m[1];
  if (/^\d{15,25}$/.test(raw)) return raw;
  return null;
}

async function resolveMember(message, raw) {
  const id = parseIdOrMention(raw);
  if (!id) return null;
  return await message.guild.members.fetch(id).catch(() => null);
}

function parseRoleId(raw) {
  if (!raw) return null;
  const m = raw.match(/^<@&(\d+)>$/);
  if (m) return m[1];
  if (/^\d{15,25}$/.test(raw)) return raw;
  return null;
}

function rest(args, start) {
  const t = args.slice(start).join(" ").trim();
  return t.length ? t : "No reason provided";
}

async function getTextChannel(guild, id) {
  if (!id) return null;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (!ch || !ch.isTextBased()) return null;
  return ch;
}

async function modlog(guild, text) {
  const ch = await getTextChannel(guild, MODLOG_CHANNEL_ID);
  if (!ch) return;
  await ch.send({ embeds: [embed(text, "Mod Log")] }).catch(() => {});
}

function humanUptime(ms) {
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

/* Sticky behavior */
async function handleSticky(message) {
  if (!message.guild || message.author.bot) return;
  const sticky = getSticky(message.guild.id, message.channel.id);
  if (!sticky) return;
  if (sticky.lastMessageId && message.id === sticky.lastMessageId) return;

  setTimeout(async () => {
    try {
      const sent = await message.channel.send({ embeds: [embed(sticky.text, "Sticky")] });
      setStickyLastId(message.guild.id, message.channel.id, sent.id);
    } catch {}
  }, 1100);
}

/* AFK mention ping */
async function handleAFK(message) {
  if (!message.guild || message.author.bot) return;

  // if author is AFK, remove AFK
  const mine = getAFK(message.guild.id, message.author.id);
  if (mine) {
    clearAFK(message.guild.id, message.author.id);
    await message.channel.send({ embeds: [embed(`<@${message.author.id}> is no longer AFK.`, "AFK")] }).catch(() => {});
  }

  // if mentions AFK users
  for (const user of message.mentions.users.values()) {
    const afk = getAFK(message.guild.id, user.id);
    if (afk) {
      await message.channel.send({
        embeds: [embed(`<@${user.id}> is AFK: ${afk.msg}`, "AFK")]
      }).catch(() => {});
    }
  }
}

function helpText() {
  return [
    `Prefix: ${PREFIX}`,
    "",
    "Moderation",
    `${PREFIX}ban <@user|id> (reason)`,
    `${PREFIX}unban <userId> (reason)`,
    `${PREFIX}kick <@user|id> (reason)`,
    `${PREFIX}mute <@user|id> <minutes> (reason)`,
    `${PREFIX}unmute <@user|id> (reason)`,
    `${PREFIX}timeout <@user|id> <minutes> (reason)`,
    `${PREFIX}untimeout <@user|id> (reason)`,
    `${PREFIX}warn <@user|id> (reason)`,
    `${PREFIX}warnings <@user|id>`,
    `${PREFIX}clearwarn <@user|id>`,
    `${PREFIX}purge <1-100>`,
    `${PREFIX}clear <1-100>`,
    `${PREFIX}slowmode <seconds>`,
    `${PREFIX}lock`,
    `${PREFIX}unlock`,
    `${PREFIX}nick <@user|id> <nickname>`,
    `${PREFIX}role add <@user|id> <@role|roleId>`,
    `${PREFIX}role remove <@user|id> <@role|roleId>`,
    "",
    "Utility",
    `${PREFIX}ping`,
    `${PREFIX}help`,
    `${PREFIX}userinfo <@user|id>`,
    `${PREFIX}serverinfo`,
    `${PREFIX}avatar <@user|id>`,
    `${PREFIX}banner <@user|id>`,
    `${PREFIX}uptime`,
    `${PREFIX}botinfo`,
    `${PREFIX}invite`,
    `${PREFIX}stats`,
    `${PREFIX}8ball <question...>`,
    `${PREFIX}coinflip`,
    `${PREFIX}dice`,
    `${PREFIX}joke`,
    `${PREFIX}rate <thing...>`,
    `${PREFIX}say <message...>`,
    `${PREFIX}poll <question...>`,
    "",
    "Server Management",
    `${PREFIX}addrole <@user|id> <@role|roleId>`,
    `${PREFIX}removerole <@user|id> <@role|roleId>`,
    `${PREFIX}roleinfo <@role|roleId>`,
    `${PREFIX}createrole <name>`,
    `${PREFIX}deleterole <@role|roleId>`,
    `${PREFIX}channelinfo`,
    `${PREFIX}createchannel <name>`,
    `${PREFIX}deletechannel`,
    "",
    "Voice",
    `${PREFIX}disconnect <@user|id> (reason)`,
    `${PREFIX}disconnectall (reason)`,
    `${PREFIX}move <@user|id> <voiceChannelId>`,
    `${PREFIX}mutevc <@user|id> (reason)`,
    `${PREFIX}unmutevc <@user|id> (reason)`,
    "",
    "Extra",
    `${PREFIX}sticky set <text...>`,
    `${PREFIX}sticky remove`,
    `${PREFIX}sticky show`,
    `${PREFIX}announce <#channel|channelId> <message...>`,
    `${PREFIX}afk <message...>`,
    `${PREFIX}suggest <text...>`,
    `${PREFIX}report <@user|id> <reason...>`,
    `${PREFIX}ticket <reason...>`,
  ].join("\n");
}

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  await handleAFK(message);
  await handleSticky(message);

  if (!message.guild) return;
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (args.shift() || "").toLowerCase();

  /* Utility */
  if (cmd === "help") {
    return message.channel.send({ embeds: [embed("```" + helpText() + "```", "Help")] });
  }

  if (cmd === "ping") {
    return message.channel.send({ embeds: [embed(`Latency: ${client.ws.ping}ms`, "Ping")] });
  }

  if (cmd === "serverinfo") {
    const g = message.guild;
    const owner = await g.fetchOwner().catch(() => null);
    const txt =
      `Name: ${g.name}\n` +
      `ID: ${g.id}\n` +
      `Owner: ${owner ? owner.user.tag : "Unknown"}\n` +
      `Members: ${g.memberCount}\n` +
      `Created: ${g.createdAt.toLocaleString()}`;
    return message.channel.send({ embeds: [embed(txt, "Server Info")] });
  }

  if (cmd === "userinfo") {
    const m = await resolveMember(message, args[0]);
    if (!m) return message.channel.send({ embeds: [usage(`${PREFIX}userinfo`, "Show user info", `${PREFIX}userinfo <@user|id>`)] });

    const txt =
      `User: ${m.user.tag}\n` +
      `ID: ${m.id}\n` +
      `Joined: ${m.joinedAt ? m.joinedAt.toLocaleString() : "Unknown"}\n` +
      `Created: ${m.user.createdAt.toLocaleString()}`;
    return message.channel.send({ embeds: [embed(txt, "User Info")] });
  }

  if (cmd === "avatar") {
    const m = await resolveMember(message, args[0]) || message.member;
    const url = m.user.displayAvatarURL({ size: 1024 });
    return message.channel.send({ embeds: [embed(url, "Avatar")] });
  }

  if (cmd === "banner") {
    const m = await resolveMember(message, args[0]) || message.member;
    const u = await m.user.fetch().catch(() => null);
    const url = u?.bannerURL({ size: 1024 }) || "No banner found.";
    return message.channel.send({ embeds: [embed(url, "Banner")] });
  }

  if (cmd === "uptime") {
    return message.channel.send({ embeds: [embed(humanUptime(Date.now() - startedAt), "Uptime")] });
  }

  if (cmd === "botinfo" || cmd === "stats") {
    const txt =
      `Tag: ${client.user.tag}\n` +
      `Servers: ${client.guilds.cache.size}\n` +
      `Users (approx): ${client.users.cache.size}\n` +
      `Uptime: ${humanUptime(Date.now() - startedAt)}`;
    return message.channel.send({ embeds: [embed(txt, "Bot Info")] });
  }

  if (cmd === "invite") {
    if (!CLIENT_ID) return message.channel.send({ embeds: [embed("Missing CLIENT_ID in Railway Variables.", "Invite")] });
    const link = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;
    return message.channel.send({ embeds: [embed(link, "Invite Link")] });
  }

  // Fun (simple local)
  if (cmd === "8ball") {
    const q = args.join(" ");
    if (!q) return message.channel.send({ embeds: [usage(`${PREFIX}8ball`, "Magic 8ball", `${PREFIX}8ball <question...>`)] });
    const answers = ["Yes.", "No.", "Maybe.", "Probably.", "I don't think so.", "Ask again later."];
    return message.channel.send({ embeds: [embed(answers[Math.floor(Math.random() * answers.length)], "8ball")] });
  }

  if (cmd === "coinflip") {
    return message.channel.send({ embeds: [embed(Math.random() < 0.5 ? "Heads" : "Tails", "Coinflip")] });
  }

  if (cmd === "dice") {
    return message.channel.send({ embeds: [embed(`You rolled: ${1 + Math.floor(Math.random() * 6)}`, "Dice")] });
  }

  if (cmd === "joke") {
    const jokes = ["I told my computer I needed a break. It said: no problem, I'll go to sleep.", "Why did the dev go broke? Too many cache misses."];
    return message.channel.send({ embeds: [embed(jokes[Math.floor(Math.random() * jokes.length)], "Joke")] });
  }

  if (cmd === "rate") {
    const thing = args.join(" ");
    if (!thing) return message.channel.send({ embeds: [usage(`${PREFIX}rate`, "Rate something", `${PREFIX}rate <thing...>`)] });
    const score = Math.floor(Math.random() * 11);
    return message.channel.send({ embeds: [embed(`${thing}\nRating: ${score}/10`, "Rate")] });
  }

  if (cmd === "say") {
    const text = args.join(" ");
    if (!text) return message.channel.send({ embeds: [usage(`${PREFIX}say`, "Repeat message", `${PREFIX}say <message...>`)] });
    return message.channel.send({ embeds: [embed(text, "Say")] });
  }

  if (cmd === "poll") {
    const q = args.join(" ");
    if (!q) return message.channel.send({ embeds: [usage(`${PREFIX}poll`, "Create poll", `${PREFIX}poll <question...>`)] });
    const msg = await message.channel.send({ embeds: [embed(q, "Poll")] });
    await msg.react("👍").catch(() => {});
    await msg.react("👎").catch(() => {});
    return;
  }

  /* Moderation */
  if (cmd === "warn") {
    const need = PermissionsBitField.Flags.ModerateMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Moderate Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    if (!target) return message.channel.send({ embeds: [usage(`${PREFIX}warn`, "Warn a user", `${PREFIX}warn <@user|id> (reason)`)] });

    const reason = rest(args, 1);
    const list = addWarning(message.guild.id, target.id, { at: Date.now(), modId: message.author.id, reason });
    const caseNo = nextCase(message.guild.id);

    await message.channel.send({ embeds: [embed(`${target} has been warned.\nReason: ${reason}\nWarnings: ${list.length}`, `Warn | Case #${caseNo}`)] });
    await modlog(message.guild, `Case #${caseNo}\nAction: Warn\nUser: ${target.user.tag} (${target.id})\nModerator: ${message.author.tag} (${message.author.id})\nReason: ${reason}`);
    return;
  }

  if (cmd === "warnings") {
    const need = PermissionsBitField.Flags.ModerateMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Moderate Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    if (!target) return message.channel.send({ embeds: [usage(`${PREFIX}warnings`, "Show warnings", `${PREFIX}warnings <@user|id>`)] });

    const list = getWarnings(message.guild.id, target.id);
    if (list.length === 0) return message.channel.send({ embeds: [embed(`${target} has no warnings.`, "Warnings")] });

    const last = list.slice(-10).map((w, i) => `${i + 1}. ${w.reason}`).join("\n");
    return message.channel.send({ embeds: [embed(`User: ${target}\nTotal: ${list.length}\n\n${last}`, "Warnings")] });
  }

  if (cmd === "clearwarn" || cmd === "clearwarnings") {
    const need = PermissionsBitField.Flags.ModerateMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Moderate Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    if (!target) return message.channel.send({ embeds: [usage(`${PREFIX}clearwarn`, "Clear warnings", `${PREFIX}clearwarn <@user|id>`)] });

    clearWarnings(message.guild.id, target.id);
    const caseNo = nextCase(message.guild.id);

    await message.channel.send({ embeds: [embed(`${target} warnings cleared.`, `ClearWarn | Case #${caseNo}`)] });
    await modlog(message.guild, `Case #${caseNo}\nAction: ClearWarn\nUser: ${target.user.tag} (${target.id})\nModerator: ${message.author.tag} (${message.author.id})`);
    return;
  }

  if (cmd === "kick") {
    const need = PermissionsBitField.Flags.KickMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Kick Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    if (!target) return message.channel.send({ embeds: [usage(`${PREFIX}kick`, "Kick a user", `${PREFIX}kick <@user|id> (reason)`)] });

    const reason = rest(args, 1);
    if (!target.kickable) return message.channel.send({ embeds: [embed("I cannot kick this user (role hierarchy).", "Error")] });

    await target.kick(reason);
    const caseNo = nextCase(message.guild.id);

    await message.channel.send({ embeds: [embed(`${target.user.tag} has been kicked.\nReason: ${reason}`, `Kick | Case #${caseNo}`)] });
    await modlog(message.guild, `Case #${caseNo}\nAction: Kick\nUser: ${target.user.tag} (${target.id})\nModerator: ${message.author.tag} (${message.author.id})\nReason: ${reason}`);
    return;
  }

  if (cmd === "ban") {
    const need = PermissionsBitField.Flags.BanMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Ban Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    if (!target) return message.channel.send({ embeds: [usage(`${PREFIX}ban`, "Ban a user", `${PREFIX}ban <@user|id> (reason)`)] });

    const reason = rest(args, 1);
    await message.guild.members.ban(target.id, { reason }).catch(() => null);
    const caseNo = nextCase(message.guild.id);

    await message.channel.send({ embeds: [embed(`${target.user.tag} has been banned.\nReason: ${reason}`, `Ban | Case #${caseNo}`)] });
    await modlog(message.guild, `Case #${caseNo}\nAction: Ban\nUser: ${target.user.tag} (${target.id})\nModerator: ${message.author.tag} (${message.author.id})\nReason: ${reason}`);
    return;
  }

  if (cmd === "unban") {
    const need = PermissionsBitField.Flags.BanMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Ban Members", "Error")] });

    const id = parseIdOrMention(args[0]); // expect ID
    if (!id) return message.channel.send({ embeds: [usage(`${PREFIX}unban`, "Unban by user ID", `${PREFIX}unban <userId> (reason)`)] });

    const reason = rest(args, 1);
    await message.guild.members.unban(id, reason).catch(() => null);
    const caseNo = nextCase(message.guild.id);

    await message.channel.send({ embeds: [embed(`Unbanned user ID: ${id}\nReason: ${reason}`, `Unban | Case #${caseNo}`)] });
    await modlog(message.guild, `Case #${caseNo}\nAction: Unban\nUserID: ${id}\nModerator: ${message.author.tag} (${message.author.id})\nReason: ${reason}`);
    return;
  }

  // mute/unmute = timeout-based (simple)
  if (cmd === "mute") {
    const need = PermissionsBitField.Flags.ModerateMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Moderate Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    const minutes = parseInt(args[1], 10);
    if (!target || !Number.isFinite(minutes)) {
      return message.channel.send({ embeds: [usage(`${PREFIX}mute`, "Mute a user (timeout)", `${PREFIX}mute <@user|id> <minutes> (reason)`)] });
    }

    const reason = rest(args, 2);
    await target.timeout(minutes * 60 * 1000, reason).catch(() => null);
    const caseNo = nextCase(message.guild.id);

    await message.channel.send({ embeds: [embed(`${target.user.tag} has been muted.\nDuration: ${minutes} minute(s)\nReason: ${reason}`, `Mute | Case #${caseNo}`)] });
    await modlog(message.guild, `Case #${caseNo}\nAction: Mute\nUser: ${target.user.tag} (${target.id})\nModerator: ${message.author.tag} (${message.author.id})\nMinutes: ${minutes}\nReason: ${reason}`);
    return;
  }

  if (cmd === "unmute") {
    const need = PermissionsBitField.Flags.ModerateMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Moderate Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    if (!target) return message.channel.send({ embeds: [usage(`${PREFIX}unmute`, "Unmute a user (remove timeout)", `${PREFIX}unmute <@user|id> (reason)`)] });

    const reason = rest(args, 1);
    await target.timeout(null, reason).catch(() => null);
    const caseNo = nextCase(message.guild.id);

    await message.channel.send({ embeds: [embed(`${target.user.tag} has been unmuted.\nReason: ${reason}`, `Unmute | Case #${caseNo}`)] });
    await modlog(message.guild, `Case #${caseNo}\nAction: Unmute\nUser: ${target.user.tag} (${target.id})\nModerator: ${message.author.tag} (${message.author.id})\nReason: ${reason}`);
    return;
  }

  if (cmd === "timeout") {
    const need = PermissionsBitField.Flags.ModerateMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Moderate Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    const minutes = parseInt(args[1], 10);
    if (!target || !Number.isFinite(minutes)) {
      return message.channel.send({ embeds: [usage(`${PREFIX}timeout`, "Timeout a user", `${PREFIX}timeout <@user|id> <minutes> (reason)`)] });
    }

    const reason = rest(args, 2);
    await target.timeout(minutes * 60 * 1000, reason).catch(() => null);
    const caseNo = nextCase(message.guild.id);

    await message.channel.send({ embeds: [embed(`${target.user.tag} has been timed out.\nDuration: ${minutes} minute(s)\nReason: ${reason}`, `Timeout | Case #${caseNo}`)] });
    await modlog(message.guild, `Case #${caseNo}\nAction: Timeout\nUser: ${target.user.tag} (${target.id})\nModerator: ${message.author.tag} (${message.author.id})\nMinutes: ${minutes}\nReason: ${reason}`);
    return;
  }

  if (cmd === "untimeout") {
    const need = PermissionsBitField.Flags.ModerateMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Moderate Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    if (!target) return message.channel.send({ embeds: [usage(`${PREFIX}untimeout`, "Remove timeout", `${PREFIX}untimeout <@user|id> (reason)`)] });

    const reason = rest(args, 1);
    await target.timeout(null, reason).catch(() => null);
    const caseNo = nextCase(message.guild.id);

    await message.channel.send({ embeds: [embed(`${target.user.tag} timeout removed.\nReason: ${reason}`, `UnTimeout | Case #${caseNo}`)] });
    await modlog(message.guild, `Case #${caseNo}\nAction: UnTimeout\nUser: ${target.user.tag} (${target.id})\nModerator: ${message.author.tag} (${message.author.id})\nReason: ${reason}`);
    return;
  }

  if (cmd === "purge" || cmd === "clear") {
    const need = PermissionsBitField.Flags.ManageMessages;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Messages", "Error")] });

    const amount = parseInt(args[0], 10);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100) {
      return message.channel.send({ embeds: [usage(`${PREFIX}${cmd}`, "Delete messages", `${PREFIX}${cmd} <1-100>`)] });
    }

    const deleted = await message.channel.bulkDelete(amount, true).catch(() => null);
    const count = deleted ? deleted.size : 0;
    const caseNo = nextCase(message.guild.id);

    await message.channel.send({ embeds: [embed(`Deleted ${count} messages.`, `Purge | Case #${caseNo}`)] }).catch(() => {});
    await modlog(message.guild, `Case #${caseNo}\nAction: Purge\nChannel: #${message.channel.name} (${message.channel.id})\nModerator: ${message.author.tag} (${message.author.id})\nDeleted: ${count}`);
    return;
  }

  if (cmd === "slowmode") {
    const need = PermissionsBitField.Flags.ManageChannels;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Channels", "Error")] });

    const seconds = parseInt(args[0], 10);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 21600) {
      return message.channel.send({ embeds: [usage(`${PREFIX}slowmode`, "Set slowmode for this channel", `${PREFIX}slowmode <seconds>`)] });
    }

    await message.channel.setRateLimitPerUser(seconds).catch(() => null);
    return message.channel.send({ embeds: [embed(`Slowmode set to ${seconds}s.`, "Slowmode")] });
  }

  if (cmd === "lock" || cmd === "unlock") {
    const need = PermissionsBitField.Flags.ManageChannels;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Channels", "Error")] });

    const everyone = message.guild.roles.everyone;
    const allow = cmd === "unlock";
    await message.channel.permissionOverwrites.edit(everyone, { SendMessages: allow }).catch(() => null);
    return message.channel.send({ embeds: [embed(allow ? "Channel unlocked." : "Channel locked.", "Lock")] });
  }

  if (cmd === "nick") {
    const need = PermissionsBitField.Flags.ManageNicknames;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Nicknames", "Error")] });

    const target = await resolveMember(message, args[0]);
    const nickname = args.slice(1).join(" ").trim();
    if (!target || !nickname) return message.channel.send({ embeds: [usage(`${PREFIX}nick`, "Change nickname", `${PREFIX}nick <@user|id> <nickname>`)] });

    await target.setNickname(nickname).catch(() => null);
    return message.channel.send({ embeds: [embed(`Nickname updated for ${target.user.tag}.`, "Nick")] });
  }

  // role add/remove + addrole/removerole
  if (cmd === "role" || cmd === "addrole" || cmd === "removerole") {
    const need = PermissionsBitField.Flags.ManageRoles;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Roles", "Error")] });

    let action, userArg, roleArg;
    if (cmd === "role") {
      action = (args[0] || "").toLowerCase();
      userArg = args[1];
      roleArg = args[2];
      if (!["add", "remove"].includes(action)) {
        return message.channel.send({ embeds: [usage(`${PREFIX}role`, "Add/remove role", `${PREFIX}role add <@user|id> <@role|roleId>\n${PREFIX}role remove <@user|id> <@role|roleId>`)] });
      }
    } else {
      action = cmd === "addrole" ? "add" : "remove";
      userArg = args[0];
      roleArg = args[1];
    }

    const target = await resolveMember(message, userArg);
    const roleId = parseRoleId(roleArg);
    if (!target || !roleId) {
      return message.channel.send({ embeds: [usage(`${PREFIX}${cmd}`, "Role command", `${PREFIX}${cmd} <@user|id> <@role|roleId>`)] });
    }

    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) return message.channel.send({ embeds: [embed("Role not found.", "Error")] });

    if (action === "add") await target.roles.add(role).catch(() => null);
    else await target.roles.remove(role).catch(() => null);

    return message.channel.send({ embeds: [embed(`${action === "add" ? "Added" : "Removed"} ${role} ${action === "add" ? "to" : "from"} ${target}.`, "Role")] });
  }

  /* Server management */
  if (cmd === "roleinfo") {
    const roleId = parseRoleId(args[0]);
    if (!roleId) return message.channel.send({ embeds: [usage(`${PREFIX}roleinfo`, "Show role info", `${PREFIX}roleinfo <@role|roleId>`)] });

    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) return message.channel.send({ embeds: [embed("Role not found.", "Error")] });

    const txt =
      `Name: ${role.name}\n` +
      `ID: ${role.id}\n` +
      `Members: ${role.members.size}\n` +
      `Color: ${role.hexColor}\n` +
      `Created: ${role.createdAt.toLocaleString()}`;
    return message.channel.send({ embeds: [embed(txt, "Role Info")] });
  }

  if (cmd === "createrole") {
    const need = PermissionsBitField.Flags.ManageRoles;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Roles", "Error")] });

    const name = args.join(" ").trim();
    if (!name) return message.channel.send({ embeds: [usage(`${PREFIX}createrole`, "Create role", `${PREFIX}createrole <name>`)] });

    const role = await message.guild.roles.create({ name }).catch(() => null);
    if (!role) return message.channel.send({ embeds: [embed("Failed to create role.", "Error")] });

    return message.channel.send({ embeds: [embed(`Role created: ${role} (${role.id})`, "Create Role")] });
  }

  if (cmd === "deleterole") {
    const need = PermissionsBitField.Flags.ManageRoles;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Roles", "Error")] });

    const roleId = parseRoleId(args[0]);
    if (!roleId) return message.channel.send({ embeds: [usage(`${PREFIX}deleterole`, "Delete role", `${PREFIX}deleterole <@role|roleId>`)] });

    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) return message.channel.send({ embeds: [embed("Role not found.", "Error")] });

    await role.delete().catch(() => null);
    return message.channel.send({ embeds: [embed("Role deleted.", "Delete Role")] });
  }

  if (cmd === "channelinfo") {
    const ch = message.channel;
    const txt =
      `Name: ${ch.name}\n` +
      `ID: ${ch.id}\n` +
      `Type: ${ch.type}\n` +
      `Created: ${ch.createdAt.toLocaleString()}`;
    return message.channel.send({ embeds: [embed(txt, "Channel Info")] });
  }

  if (cmd === "createchannel") {
    const need = PermissionsBitField.Flags.ManageChannels;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Channels", "Error")] });

    const name = args.join(" ").trim();
    if (!name) return message.channel.send({ embeds: [usage(`${PREFIX}createchannel`, "Create a text channel", `${PREFIX}createchannel <name>`)] });

    const ch = await message.guild.channels.create({ name, type: ChannelType.GuildText }).catch(() => null);
    if (!ch) return message.channel.send({ embeds: [embed("Failed to create channel.", "Error")] });

    return message.channel.send({ embeds: [embed(`Channel created: <#${ch.id}>`, "Create Channel")] });
  }

  if (cmd === "deletechannel") {
    const need = PermissionsBitField.Flags.ManageChannels;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Channels", "Error")] });

    await message.channel.delete().catch(() => null);
    return;
  }

  /* Voice */
  if (cmd === "disconnect") {
    const need = PermissionsBitField.Flags.MoveMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Move Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    if (!target) return message.channel.send({ embeds: [usage(`${PREFIX}disconnect`, "Disconnect user from VC", `${PREFIX}disconnect <@user|id> (reason)`)] });

    const reason = rest(args, 1);
    if (!target.voice?.channel) return message.channel.send({ embeds: [embed("User is not in a voice channel.", "Voice")] });

    await target.voice.disconnect(reason).catch(() => null);
    return message.channel.send({ embeds: [embed(`Disconnected ${target.user.tag} from voice.\nReason: ${reason}`, "Voice")] });
  }

  if (cmd === "disconnectall") {
    const need = PermissionsBitField.Flags.MoveMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Move Members", "Error")] });

    const reason = rest(args, 0);
    const vc = message.member.voice?.channel;
    if (!vc) return message.channel.send({ embeds: [embed("You must be in a voice channel.", "Voice")] });

    let count = 0;
    for (const [, mem] of vc.members) {
      if (mem.user.bot) continue;
      await mem.voice.disconnect(reason).catch(() => {});
      count++;
    }
    return message.channel.send({ embeds: [embed(`Disconnected ${count} user(s) from ${vc.name}.\nReason: ${reason}`, "Voice")] });
  }

  if (cmd === "move") {
    const need = PermissionsBitField.Flags.MoveMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Move Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    const vcId = parseIdOrMention(args[1]) || args[1];
    if (!target || !vcId) return message.channel.send({ embeds: [usage(`${PREFIX}move`, "Move user to a voice channel", `${PREFIX}move <@user|id> <voiceChannelId>`)] });

    const vc = await message.guild.channels.fetch(vcId).catch(() => null);
    if (!vc || vc.type !== ChannelType.GuildVoice) return message.channel.send({ embeds: [embed("Voice channel not found.", "Error")] });

    await target.voice.setChannel(vc).catch(() => null);
    return message.channel.send({ embeds: [embed(`Moved ${target.user.tag} to ${vc.name}.`, "Move")] });
  }

  if (cmd === "mutevc" || cmd === "unmutevc") {
    const need = PermissionsBitField.Flags.MuteMembers;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Mute Members", "Error")] });

    const target = await resolveMember(message, args[0]);
    if (!target) return message.channel.send({ embeds: [usage(`${PREFIX}${cmd}`, "Voice mute/unmute", `${PREFIX}${cmd} <@user|id> (reason)`)] });

    if (!target.voice?.channel) return message.channel.send({ embeds: [embed("User is not in a voice channel.", "Voice")] });

    const shouldMute = cmd === "mutevc";
    await target.voice.setMute(shouldMute).catch(() => null);

    return message.channel.send({ embeds: [embed(`${shouldMute ? "Muted" : "Unmuted"} ${target.user.tag} in voice.`, "Voice")] });
  }

  /* Extra: sticky / announce / embed / remind / afk / suggest / report / ticket */
  if (cmd === "sticky") {
    const sub = (args[0] || "").toLowerCase();

    if (sub === "set") {
      const need = PermissionsBitField.Flags.ManageMessages;
      if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Messages", "Error")] });

      const text = message.content.split(/\s+/).slice(2).join(" ").trim();
      if (!text) return message.channel.send({ embeds: [usage(`${PREFIX}sticky set`, "Set sticky for this channel", `${PREFIX}sticky set <text...>`)] });

      setSticky(message.guild.id, message.channel.id, text);
      return message.channel.send({ embeds: [embed("Sticky message set.", "Sticky")] });
    }

    if (sub === "remove") {
      const need = PermissionsBitField.Flags.ManageMessages;
      if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Messages", "Error")] });

      removeSticky(message.guild.id, message.channel.id);
      return message.channel.send({ embeds: [embed("Sticky message removed.", "Sticky")] });
    }

    if (sub === "show") {
      const st = getSticky(message.guild.id, message.channel.id);
      if (!st) return message.channel.send({ embeds: [embed("No sticky set for this channel.", "Sticky")] });
      return message.channel.send({ embeds: [embed(st.text, "Sticky")] });
    }

    return message.channel.send({ embeds: [usage(`${PREFIX}sticky`, "Sticky commands", `${PREFIX}sticky set <text...>\n${PREFIX}sticky remove\n${PREFIX}sticky show`)] });
  }

  if (cmd === "announce") {
    const need = PermissionsBitField.Flags.ManageMessages;
    if (!hasPerm(message.member, need)) return message.channel.send({ embeds: [embed("Missing permission: Manage Messages", "Error")] });

    const chRaw = args[0];
    const chId = chRaw?.match(/^<#(\d+)>$/)?.[1] || (parseIdOrMention(chRaw));
    if (!chId) return message.channel.send({ embeds: [usage(`${PREFIX}announce`, "Send announcement embed", `${PREFIX}announce <#channel|channelId> <message...>`)] });

    const ch = await message.guild.channels.fetch(chId).catch(() => null);
    if (!ch || !ch.isTextBased()) return message.channel.send({ embeds: [embed("Channel not found.", "Error")] });

    const text = args.slice(1).join(" ").trim();
    if (!text) return message.channel.send({ embeds: [usage(`${PREFIX}announce`, "Send announcement embed", `${PREFIX}announce <#channel|channelId> <message...>`)] });

    await ch.send({ embeds: [embed(text, "Announcement")] });
    return message.channel.send({ embeds: [embed("Announcement sent.", "Announce")] });
  }

  if (cmd === "afk") {
    const msg = args.join(" ").trim() || "AFK";
    setAFK(message.guild.id, message.author.id, msg);
    return message.channel.send({ embeds: [embed(`<@${message.author.id}> is now AFK: ${msg}`, "AFK")] });
  }

  if (cmd === "suggest") {
    const text = args.join(" ").trim();
    if (!text) return message.channel.send({ embeds: [usage(`${PREFIX}suggest`, "Send suggestion", `${PREFIX}suggest <text...>`)] });

    const ch = await getTextChannel(message.guild, SUGGEST_CHANNEL_ID);
    if (!ch) return message.channel.send({ embeds: [embed("Suggestions channel not set. Add SUGGEST_CHANNEL_ID in Railway Variables.", "Suggest")] });

    const msg = await ch.send({ embeds: [embed(`From: <@${message.author.id}>\n\n${text}`, "Suggestion")] });
    await msg.react("👍").catch(() => {});
    await msg.react("👎").catch(() => {});
    return message.channel.send({ embeds: [embed("Suggestion sent.", "Suggest")] });
  }

  if (cmd === "report") {
    const target = await resolveMember(message, args[0]);
    const reason = args.slice(1).join(" ").trim();
    if (!target || !reason) return message.channel.send({ embeds: [usage(`${PREFIX}report`, "Report a user", `${PREFIX}report <@user|id> <reason...>`)] });

    const ch = await getTextChannel(message.guild, REPORT_CHANNEL_ID);
    if (!ch) return message.channel.send({ embeds: [embed("Reports channel not set. Add REPORT_CHANNEL_ID in Railway Variables.", "Report")] });

    await ch.send({ embeds: [embed(`Reporter: <@${message.author.id}>\nUser: ${target.user.tag} (${target.id})\nReason: ${reason}`, "Report")] });
    return message.channel.send({ embeds: [embed("Report sent to staff.", "Report")] });
  }

  if (cmd === "ticket") {
    const reason = args.join(" ").trim() || "Support needed";
    if (!TICKET_CATEGORY_ID) return message.channel.send({ embeds: [embed("TICKET_CATEGORY_ID not set in Railway Variables.", "Ticket")] });

    const cat = await message.guild.channels.fetch(TICKET_CATEGORY_ID).catch(() => null);
    if (!cat) return message.channel.send({ embeds: [embed("Ticket category not found.", "Ticket")] });

    const name = `ticket-${message.author.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const ch = await message.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: cat.id,
      permissionOverwrites: [
        { id: message.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ]
    }).catch(() => null);

    if (!ch) return message.channel.send({ embeds: [embed("Failed to create ticket.", "Ticket")] });

    await ch.send({ embeds: [embed(`User: <@${message.author.id}>\nReason: ${reason}`, "Ticket Created")] });
    return message.channel.send({ embeds: [embed(`Ticket created: <#${ch.id}>`, "Ticket")] });
  }

  // unknown
  return message.channel.send({ embeds: [embed(`Unknown command. Use ${PREFIX}help`, "Error")] });
});

// keep whitespace-safe token
client.login((process.env.TOKEN || "").trim());
