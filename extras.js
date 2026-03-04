// extras.js
const { EmbedBuilder } = require("discord.js");

// darker yellow (same theme)
const DARK_YELLOW = 0xD4A017;

function E(desc, title = null) {
  const em = new EmbedBuilder().setColor(DARK_YELLOW).setDescription(desc).setTimestamp();
  if (title) em.setTitle(title);
  return em;
}

// Simple economy storage inside your existing data.json (db.levels/warnings style)
// We assume your main file has `db` loaded globally; we will store in db.economy[guildId][userId]
function ensureEco(db, guildId, userId) {
  db.economy ??= {};
  db.economy[guildId] ??= {};
  db.economy[guildId][userId] ??= { wallet: 0, bank: 0, lastDaily: 0, lastWork: 0 };
  return db.economy[guildId][userId];
}

function formatMoney(n) {
  return `${n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function now() {
  return Date.now();
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Register extra slash commands in your interactionCreate handler
async function handleExtrasSlash(interaction, { db, saveDB }) {
  if (!interaction.isChatInputCommand()) return false;

  const name = interaction.commandName;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  // ECONOMY
  if (name === "balance") {
    const u = interaction.options.getUser("user") || interaction.user;
    const d = ensureEco(db, guildId, u.id);
    return interaction.reply({
      embeds: [E(`User: <@${u.id}>\nWallet: **${formatMoney(d.wallet)}**\nBank: **${formatMoney(d.bank)}**`, "Balance")]
    }).then(() => true);
  }

  if (name === "daily") {
    const d = ensureEco(db, guildId, userId);
    const cooldown = 24 * 60 * 60 * 1000;
    if (now() - d.lastDaily < cooldown) {
      const left = Math.ceil((cooldown - (now() - d.lastDaily)) / (60 * 1000));
      await interaction.reply({ ephemeral: true, embeds: [E(`Daily already claimed. Try again in **${left} min**.`, "Daily")] });
      return true;
    }
    const amount = rand(150, 350);
    d.wallet += amount;
    d.lastDaily = now();
    saveDB(db);
    await interaction.reply({ embeds: [E(`You claimed **${formatMoney(amount)}** coins.\nWallet: **${formatMoney(d.wallet)}**`, "Daily")] });
    return true;
  }

  if (name === "work") {
    const d = ensureEco(db, guildId, userId);
    const cooldown = 30 * 60 * 1000; // 30 mins
    if (now() - d.lastWork < cooldown) {
      const left = Math.ceil((cooldown - (now() - d.lastWork)) / (60 * 1000));
      await interaction.reply({ ephemeral: true, embeds: [E(`Work cooldown. Try again in **${left} min**.`, "Work")] });
      return true;
    }
    const jobs = ["Cashier", "Helper", "Delivery", "Editor", "Encoder", "Crew"];
    const job = jobs[rand(0, jobs.length - 1)];
    const amount = rand(80, 220);
    d.wallet += amount;
    d.lastWork = now();
    saveDB(db);
    await interaction.reply({ embeds: [E(`You worked as **${job}** and earned **${formatMoney(amount)}** coins.\nWallet: **${formatMoney(d.wallet)}**`, "Work")] });
    return true;
  }

  if (name === "beg") {
    const d = ensureEco(db, guildId, userId);
    const amount = rand(0, 120);
    const ok = amount > 10;
    if (ok) d.wallet += amount;
    saveDB(db);
    await interaction.reply({
      embeds: [E(ok ? `Someone gave you **${formatMoney(amount)}** coins.` : `No one gave you anything.`, "Beg")]
    });
    return true;
  }

  if (name === "pay") {
    const target = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);

    if (target.bot) {
      await interaction.reply({ ephemeral: true, embeds: [E("You can't pay a bot.", "Pay")] });
      return true;
    }
    if (amount <= 0) {
      await interaction.reply({ ephemeral: true, embeds: [E("Amount must be greater than 0.", "Pay")] });
      return true;
    }

    const sender = ensureEco(db, guildId, userId);
    const recv = ensureEco(db, guildId, target.id);

    if (sender.wallet < amount) {
      await interaction.reply({ ephemeral: true, embeds: [E("Not enough coins in wallet.", "Pay")] });
      return true;
    }

    sender.wallet -= amount;
    recv.wallet += amount;
    saveDB(db);

    await interaction.reply({ embeds: [E(`Transferred **${formatMoney(amount)}** coins to <@${target.id}>.`, "Pay")] });
    return true;
  }

  if (name === "gamble") {
    const bet = interaction.options.getInteger("amount", true);
    const d = ensureEco(db, guildId, userId);

    if (bet <= 0) {
      await interaction.reply({ ephemeral: true, embeds: [E("Bet must be greater than 0.", "Gamble")] });
      return true;
    }
    if (d.wallet < bet) {
      await interaction.reply({ ephemeral: true, embeds: [E("Not enough coins in wallet.", "Gamble")] });
      return true;
    }

    const win = Math.random() < 0.45;
    if (win) {
      d.wallet += bet;
      saveDB(db);
      await interaction.reply({ embeds: [E(`You won. +**${formatMoney(bet)}** coins.\nWallet: **${formatMoney(d.wallet)}**`, "Gamble")] });
    } else {
      d.wallet -= bet;
      saveDB(db);
      await interaction.reply({ embeds: [E(`You lost. -**${formatMoney(bet)}** coins.\nWallet: **${formatMoney(d.wallet)}**`, "Gamble")] });
    }
    return true;
  }

  // GAMES / FUN
  if (name === "8ball") {
    const q = interaction.options.getString("question", true);
    const answers = ["Yes", "No", "Maybe", "Likely", "Unlikely", "Ask again later"];
    const a = answers[rand(0, answers.length - 1)];
    await interaction.reply({ embeds: [E(`Question: ${q}\nAnswer: **${a}**`, "8ball")] });
    return true;
  }

  if (name === "coinflip") {
    const res = Math.random() < 0.5 ? "Heads" : "Tails";
    await interaction.reply({ embeds: [E(`Result: **${res}**`, "Coinflip")] });
    return true;
  }

  if (name === "dice") {
    const roll = rand(1, 6);
    await interaction.reply({ embeds: [E(`You rolled: **${roll}**`, "Dice")] });
    return true;
  }

  if (name === "rate") {
    const text = interaction.options.getString("text", true);
    const score = rand(0, 10);
    await interaction.reply({ embeds: [E(`"${text}"\nRating: **${score}/10**`, "Rate")] });
    return true;
  }

  if (name === "ship") {
    const u1 = interaction.options.getUser("user1", true);
    const u2 = interaction.options.getUser("user2", true);
    const score = rand(0, 100);
    await interaction.reply({ embeds: [E(`${u1} + ${u2}\nCompatibility: **${score}%**`, "Ship")] });
    return true;
  }

  if (name === "joke") {
    const jokes = [
      "I told my computer I needed a break, now it won’t stop sending me KitKats.",
      "Why did the math book look sad? It had too many problems.",
      "I tried to catch fog… I mist.",
      "Parallel lines have so much in common. It’s a shame they’ll never meet."
    ];
    await interaction.reply({ embeds: [E(jokes[rand(0, jokes.length - 1)], "Joke")] });
    return true;
  }

  return false;
}

// Extra slash commands list for registration (to add in your registerSlash)
function extraSlashCommandBuilders() {
  const { SlashCommandBuilder } = require("discord.js");

  return [
    // economy
    new SlashCommandBuilder().setName("balance").setDescription("Check wallet/bank.")
      .addUserOption(o => o.setName("user").setDescription("User (optional)")),

    new SlashCommandBuilder().setName("daily").setDescription("Claim daily coins (24h cooldown)."),
    new SlashCommandBuilder().setName("work").setDescription("Work for coins (30m cooldown)."),
    new SlashCommandBuilder().setName("beg").setDescription("Ask for spare coins."),
    new SlashCommandBuilder().setName("pay").setDescription("Pay coins to another user.")
      .addUserOption(o => o.setName("user").setDescription("Target").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)),
    new SlashCommandBuilder().setName("gamble").setDescription("Gamble coins.")
      .addIntegerOption(o => o.setName("amount").setDescription("Bet amount").setRequired(true)),

    // games
    new SlashCommandBuilder().setName("8ball").setDescription("Ask the magic 8ball.")
      .addStringOption(o => o.setName("question").setDescription("Question").setRequired(true)),

    new SlashCommandBuilder().setName("coinflip").setDescription("Flip a coin."),
    new SlashCommandBuilder().setName("dice").setDescription("Roll a dice."),
    new SlashCommandBuilder().setName("rate").setDescription("Rate something 0-10.")
      .addStringOption(o => o.setName("text").setDescription("Text").setRequired(true)),

    new SlashCommandBuilder().setName("ship").setDescription("Ship two users.")
      .addUserOption(o => o.setName("user1").setDescription("User 1").setRequired(true))
      .addUserOption(o => o.setName("user2").setDescription("User 2").setRequired(true)),

    new SlashCommandBuilder().setName("joke").setDescription("Random joke.")
  ].map(c => c.toJSON());
}

module.exports = { handleExtrasSlash, extraSlashCommandBuilders };
