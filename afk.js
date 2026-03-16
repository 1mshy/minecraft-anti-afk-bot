import 'dotenv/config';
import mineflayer from 'mineflayer';
import readline from 'readline';
import winston from 'winston';


// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, username }) => {
      const userPrefix = username ? `[${username}] ` : '';
      return `[${timestamp}] ${level}: ${userPrefix}${message}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Configuration
const CONFIG = {
  host: 'donutsmp.net',
  port: 25565,
  usernames: process.env.MC_USERNAMES_AFK ? process.env.MC_USERNAMES_AFK.split(',').map(u => u.trim()) : ['tubetop'], // List of Minecraft emails or usernames
  auth: 'microsoft', // Use 'offline' for cracked servers
  version: '1.20.4', // Changed to extremely stable 1.20.4 instead of 1.21.11 (Bedrock version) or false
  webhookUrl: process.env.WEBHOOK_URL // Add your Discord webhook URL here
};

const bots = [];

function createBot(username) {
  const botLogger = logger.child({ username });
  let bot;
  let isEating = false;
  let previousHealth = 20;
  let spawnedOnce = false;

  // Shards AFK-world tracking
  let lastShardsValue = null;
  let shardsCheckInterval = null;
  let autoReconnectTimeout = null;

  function triggerShardsQuery() {
    bot.chat('/shards');
    // Set a fallback timeout in case the server never replies to this specific query
    shardsCheckInterval = setTimeout(triggerShardsQuery, 60000);
  }

  if (autoReconnectTimeout) {
    clearTimeout(autoReconnectTimeout);
    autoReconnectTimeout = null;
  }

  // Disconnect every 6 hours to avoid sticking points
  autoReconnectTimeout = setTimeout(() => {
    botLogger.info(`6 hours have passed. Disconnecting to reconnect...`);
    if (bot) bot.quit();
  }, 6 * 60 * 60 * 1000);

  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: username,
    auth: CONFIG.auth,
    version: CONFIG.version
  });

  bots.push(bot);

  bot.once('login', () => {
    // Only patch if it exists and hasn't been patched already
    if (bot.chat && !bot.chat.patched) {
      const originalChat = bot.chat.bind(bot);
      bot.chat = (message) => {
        botLogger.info(`[CHAT-OUT] ${message}`);
        originalChat(message);
      };
      bot.chat.patched = true;
    }
  });


  async function sendDiscordWebhook(message) {
    if (!CONFIG.webhookUrl) return;
    try {
      const payload = {
        content: `**[${bot.username}]** ${message}`,
        username: bot.username,
        avatar_url: `https://mc-heads.net/avatar/${bot.username}`
      };

      await fetch(CONFIG.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      botLogger.error(`Failed to send webhook:`, err);
    }
  }

  // Shared helper — safe to call multiple times; the interval guard ensures it only starts once
  function startShardsTracking(delayMs, reason) {
    if (shardsCheckInterval) return; // already running
    botLogger.info(`[Shards] ${reason} — starting shards check in ${delayMs / 1000}s...`);
    setTimeout(() => {
      if (shardsCheckInterval) return; // another path beat us to it
      botLogger.info(`[Shards] Shards AFK-world check starting. Sending initial /shards query.`);
      triggerShardsQuery();
    }, delayMs);
  }

  bot.on('spawn', () => {
    if (!spawnedOnce) {
      botLogger.info(`Bot has spawned!`);
      spawnedOnce = true;
    }
    // Fallback: if the bot spawns already inside the AFK world (no windowOpen fires),
    // start tracking after 30s so the scoreboard has time to populate.
    startShardsTracking(30000, 'Spawned (fallback path)');
  });

  bot.on('windowOpen', (window) => {
    const slotToClick = 49;
    botLogger.info(`Window opened: ${window.title ? window.title : 'Unknown'} (${window.type})`);

    setTimeout(() => {
      botLogger.info(`Clicking slot ${slotToClick}...`);
      bot.clickWindow(slotToClick, 0, 0).then(() => {
        botLogger.info(`Successfully clicked the AFK slot.`);
        // Start tracking 15s after clicking — the window path gets priority over the spawn fallback
        startShardsTracking(15000, 'Clicked AFK slot');
      }).catch(err => {
        botLogger.error(`Error clicking window:`, err);
      });
    }, 1500);
  });

  bot.on('message', async (message) => {
    const text = message.toString();
    const match = text.match(/Your shards:\s*([\d,.]+)([kmb]?)/i);
    if (match) {
      let currentShards = parseFloat(match[1].replace(/,/g, ''));
      const suffix = match[2].toLowerCase();
      if (suffix === 'k') currentShards *= 1000;
      else if (suffix === 'm') currentShards *= 1000000;
      else if (suffix === 'b') currentShards *= 1000000000;

      botLogger.info(`[Shards] Shards now: ${currentShards}, was: ${lastShardsValue ?? 'not found'}`);

      if (lastShardsValue !== null) {
        const diff = currentShards - lastShardsValue;
        if (diff >= 1) {
          botLogger.info(`[Shards] ✅ In AFK world! Shards +${diff} since last check.`);

          // Check if we crossed a multiple of 1500
          if (Math.floor(lastShardsValue / 1500) < Math.floor(currentShards / 1500)) {
            const milestone = Math.floor(currentShards / 1500) * 1500;
            botLogger.info(`[Shards] 🎯 Milestone reached: ${milestone} shards!`);
            await sendDiscordWebhook(`🎉 **Milestone Reached!** We just hit **${milestone} shards**! (Current: ${currentShards})`);
          }

        } else {
          botLogger.info(`[Shards] ❌ NOT in AFK world! Shards diff: ${diff}. Re-sending /afk...`);
          await sendDiscordWebhook(`⚠️ **AFK Bot Alert:** Not in AFK world! Shards did not increase. Re-sending /afk.`);
          bot.chat('/afk');
        }
      } else {
        botLogger.info(`[Shards] Initial shards value set to: ${currentShards}`);
      }
      lastShardsValue = currentShards;

      if (shardsCheckInterval) {
        clearTimeout(shardsCheckInterval);
        const nextIntervalMs = (currentShards >= 1000) ? 10 * 60 * 1000 : 60 * 1000;
        botLogger.info(`[Shards] Next check scheduled in ${nextIntervalMs / 1000}s.`);
        shardsCheckInterval = setTimeout(triggerShardsQuery, nextIntervalMs);
      }
    }
  });


  bot.on('error', (err) => {
    botLogger.info(`Error: ${err}`);
  });

  bot.on('kicked', (reason) => {
    botLogger.error(`Kicked from server:`, reason);
  });

  bot.on('end', () => {
    botLogger.info(`Bot disconnected. Reconnecting in 10 seconds...`);
    spawnedOnce = false;
    if (autoReconnectTimeout) {
      clearTimeout(autoReconnectTimeout);
      autoReconnectTimeout = null;
    }
    if (shardsCheckInterval) {
      clearTimeout(shardsCheckInterval);
      shardsCheckInterval = null;
    }
    lastShardsValue = null;

    // Remove from active bots array
    const idx = bots.indexOf(bot);
    if (idx !== -1) {
      bots.splice(idx, 1);
    }

    setTimeout(() => createBot(username), 10000);
  });

  bot.on('health', async () => {
    if (bot.health < previousHealth) {
      botLogger.info(`Bot injured! Health: ${bot.health.toFixed(1)}/20`);
      await sendDiscordWebhook(`⚠️ **AFK Bot Alert:** Injured! Current health: ${bot.health.toFixed(1)}/20`);
    }
    previousHealth = bot.health;

    // Eat cooked beef if food is not full to maintain high saturation
    if (bot.food < 20 && !isEating) {
      const beef = bot.inventory.items().find(item => item.name === 'cooked_beef');
      if (beef) {
        isEating = true;
        try {
          await bot.equip(beef, 'hand');
          await bot.consume();
          botLogger.info(`Ate a cooked beef.`);
        } catch (err) {
          botLogger.error(`Error eating:`, err);
        } finally {
          isEating = false;
        }
      }
    }
  });

  bot.on('death', async () => {
    botLogger.info(`Bot died!`);
    await sendDiscordWebhook(`💀 **AFK Bot Alert:** Died!`);
  });
}

async function startAllBots() {
  for (let i = 0; i < CONFIG.usernames.length; i++) {
    const username = CONFIG.usernames[i];
    if (!username) continue;

    createBot(username);

    // Add random delay between 0 and 30 seconds for all bots except after the last one
    if (i < CONFIG.usernames.length - 1) {
      const delayMs = Math.floor(Math.random() * 30000 + 15000);
      logger.info(`Waiting ${Math.round(delayMs / 1000)} seconds before logging in the next bot...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

startAllBots();

function walkBots(blocks) {
  // Approx 1 block ~= 270ms at normal walk speed; adjust if needed
  const durationMs = blocks * 270;
  logger.info(`[Walk] Walking forward ${blocks} block(s) (~${durationMs}ms) for all bots`);
  bots.forEach(b => {
    b.setControlState('forward', true);
    b.setControlState('sneak', false);
  });
  setTimeout(() => {
    bots.forEach(b => {
      b.setControlState('forward', false);
    });
    logger.info(`[Walk] Done walking ${blocks} block(s).`);
  }, durationMs);
}

// Setup terminal command input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
logger.info("setup command passing")
rl.on('line', async (input) => {
  const trimmed = input.trim();
  if (!trimmed || bots.length === 0) return;

  const walkMatch = trimmed.match(/^\/walk\s+(\d+)$/i);
  if (walkMatch) {
    const blocks = parseInt(walkMatch[1], 10);
    walkBots(blocks);
  } else {
    bots.forEach(b => b.chat(trimmed));
  }
});

// Suppress unhandled exceptions like EPIPE
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') {
    logger.info('Caught EPIPE error, ignoring (server closed connection).');
  } else {
    logger.error('Uncaught Exception:', err);
  }
});
