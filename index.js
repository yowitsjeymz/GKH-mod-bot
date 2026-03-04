const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");
const { addWarning, getWarnings, clearWarnings } = require("./db");

const prefix = "?";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

function usage(cmd, desc, usage) {
  return (
`Command: ${cmd}
Description: ${desc}
Cooldown: 3 seconds
Usage:
${usage}`
  );
}

client.on("messageCreate", async message => {

  if (!message.guild) return;
  if (message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).split(" ");
  const cmd = args.shift().toLowerCase();

  const modlogs = message.guild.channels.cache.get(process.env.MODLOG_CHANNEL_ID);

  // HELP
  if (cmd === "help") {
    return message.channel.send(
`Commands
?warn
?warnings
?clearwarnings
?kick
?ban
?timeout
?untimeout
?purge`
    );
  }

  // WARN
  if (cmd === "warn") {

    const user = message.mentions.members.first();

    if (!user)
      return message.channel.send(
        usage("?warn","Warn a member","?warn [user] (reason)")
      );

    const reason = args.slice(1).join(" ") || "No reason";

    const warns = addWarning(message.guild.id,user.id,reason);

    message.channel.send(`${user} has been warned.`);

    if (modlogs)
      modlogs.send(`Warn | ${user.user.tag} | Moderator: ${message.author.tag} | Reason: ${reason} | Total: ${warns.length}`);
  }

  // WARNINGS
  if (cmd === "warnings") {

    const user = message.mentions.members.first();

    if (!user)
      return message.channel.send(
        usage("?warnings","Show warnings","?warnings [user]")
      );

    const warns = getWarnings(message.guild.id,user.id);

    if (!warns.length) return message.channel.send(`${user} has no warnings.`);

    message.channel.send(
      `${user} warnings:\n` + warns.map((w,i)=>`${i+1}. ${w}`).join("\n")
    );
  }

  // CLEARWARNINGS
  if (cmd === "clearwarnings") {

    const user = message.mentions.members.first();

    if (!user)
      return message.channel.send(
        usage("?clearwarnings","Clear warnings","?clearwarnings [user]")
      );

    clearWarnings(message.guild.id,user.id);

    message.channel.send(`${user} warnings cleared.`);
  }

  // KICK
  if (cmd === "kick") {

    if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers))
      return;

    const user = message.mentions.members.first();

    if (!user)
      return message.channel.send(
        usage("?kick","Kick a member","?kick [user] (reason)")
      );

    const reason = args.slice(1).join(" ") || "No reason";

    await user.kick(reason);

    message.channel.send(`${user.user.tag} has been kicked.`);

    if (modlogs)
      modlogs.send(`Kick | ${user.user.tag} | Moderator: ${message.author.tag} | Reason: ${reason}`);
  }

  // BAN
  if (cmd === "ban") {

    const user = message.mentions.members.first();

    if (!user)
      return message.channel.send(
        usage("?ban","Ban a member","?ban [user] (reason)")
      );

    const reason = args.slice(1).join(" ") || "No reason";

    await user.ban({reason});

    message.channel.send(`${user.user.tag} has been banned.`);

    if (modlogs)
      modlogs.send(`Ban | ${user.user.tag} | Moderator: ${message.author.tag} | Reason: ${reason}`);
  }

  // PURGE
  if (cmd === "purge") {

    const amount = parseInt(args[0]);

    if (!amount)
      return message.channel.send(
        usage("?purge","Delete messages","?purge [amount]")
      );

    const deleted = await message.channel.bulkDelete(amount,true);

    message.channel.send(`Purged ${deleted.size} messages.`);
  }

});


client.login((process.env.TOKEN || "").trim());
