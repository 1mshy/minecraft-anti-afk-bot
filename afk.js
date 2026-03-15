import 'dotenv/config';
import mineflayer from 'mineflayer';
import readline from 'readline';

// Configuration
const CONFIG = {
  host: 'donutsmp.net',
  port: 25565,
  username: process.env.MC_USERNAME_AFK || 'tubetop', // Change to your Minecraft email or username
  auth: 'microsoft', // Use 'offline' for cracked servers
  version: '1.20.4', // Changed to extremely stable 1.20.4 instead of 1.21.11 (Bedrock version) or false
  webhookUrl: process.env.WEBHOOK_URL // Add your Discord webhook URL here
};

let bot;
let isEating = false;
let previousHealth = 20;
let spawnedOnce = false;

// Shards AFK-world tracking
let lastShardsValue = null;
let shardsCheckInterval = null;

function createBot() {
  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    auth: CONFIG.auth,
    version: CONFIG.version
  });

  async function sendDiscordWebhook(message) {
    if (!CONFIG.webhookUrl) return;
    try {
      await fetch(CONFIG.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message })
      });
    } catch (err) {
      console.log('Failed to send webhook:', err);
    }
  }

  bot.on('spawn', () => {
    if (!spawnedOnce) {
      console.log('Bot has spawned!');
      spawnedOnce = true;
    }

    // Start shards tracking once spawned
    if (!shardsCheckInterval) {
      console.log('[Shards] Starting shards AFK-world check (every 60s)...');
      lastShardsValue = getShardsValue();
      console.log(`[Shards] Initial shards value: ${lastShardsValue ?? 'not found'}`);

      shardsCheckInterval = setInterval(async () => {
        const currentShards = getShardsValue();
        console.log(`[Shards] Current shards: ${currentShards ?? 'not found'}, Previous: ${lastShardsValue ?? 'not found'}`);

        if (currentShards !== null && lastShardsValue !== null) {
          const diff = currentShards - lastShardsValue;
          if (diff >= 1) {
            console.log(`[Shards] ✅ In AFK world! Shards increased by ${diff} over the last minute.`);
          } else {
            console.log(`[Shards] ❌ NOT in AFK world! Shards did not increase (diff: ${diff}). Re-entering AFK world...`);
            await sendDiscordWebhook(`⚠️ **AFK Bot Alert:** Not in AFK world! Shards did not increase. Re-sending /afk command.`);
            bot.chat('/afk');
          }
        } else {
          console.log('[Shards] ⚠️ Could not read shards value from scoreboard.');
        }

        lastShardsValue = currentShards;
      }, 60000); // Check every 60 seconds
    }
  });

  bot.on('windowOpen', (window) => {
    // A double chest has 54 slots in the top section
    // The fifth last slot in a 54-slot inventory (0-53) is 49. (53, 52, 51, 50, 49)
    // This is the exact middle slot of the last row.
    const slotToClick = 49;

    // We can verify it's a double chest by checking the amount of slots if we want,
    // but just assuming any window opened right after might be it.
    console.log(`Window opened: ${window.title ? window.title : 'Unknown'} (${window.type})`);

    setTimeout(() => {
      console.log(`Clicking slot ${slotToClick}...`);
      // Left click the slot to join AFK
      bot.clickWindow(slotToClick, 0, 0).then(() => {
        console.log('Successfully clicked the AFK slot.');
      }).catch(err => {
        console.log('Error clicking window:', err);
      });
    }, 1500); // 1.5 seconds delay before clicking to ensure it loads
  });

  bot.on('error', (err) => {
    console.log(`Error: ${err}`);
  });

  bot.on('kicked', (reason) => {
    console.log(`Kicked from server:`, reason);
  });

  bot.on('end', () => {
    console.log('Bot disconnected. Reconnecting in 10 seconds...');
    spawnedOnce = false;
    if (shardsCheckInterval) {
      clearInterval(shardsCheckInterval);
      shardsCheckInterval = null;
    }
    lastShardsValue = null;
    setTimeout(createBot, 10000);
  });

  bot.on('health', async () => {
    if (bot.health < previousHealth) {
      console.log(`Bot injured! Health: ${bot.health.toFixed(1)}/20`);
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
          console.log('Ate a cooked beef.');
        } catch (err) {
          console.log('Error eating:', err);
        } finally {
          isEating = false;
        }
      }
    }
  });

  bot.on('death', async () => {
    console.log('Bot died!');
    await sendDiscordWebhook(`💀 **AFK Bot Alert:** Died!`);
  });
}

/**
 * Reads the "Shards" value from the sidebar scoreboard.
 * Returns the numeric value, or null if not found.
 */
function getShardsValue() {
  try {
    // bot.scoreboard is a map of objective name -> scoreboard object
    for (const objective of Object.values(bot.scoreboard)) {
      // Check sidebar display slot
      if (objective.position === 1) { // 1 = sidebar
        for (const [name, entry] of Object.entries(objective.itemsMap ?? {})) {
          // Strip Minecraft formatting codes for comparison
          const cleanName = name.replace(/§./g, '').toLowerCase();
          if (cleanName.includes('shards')) {
            return entry.value;
          }
        }
      }
    }
  } catch (err) {
    console.log('[Shards] Error reading scoreboard:', err);
  }
  return null;
}

createBot();

// Setup terminal command input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
console.log("setup command passing")
rl.on('line', (input) => {
  if (input.trim() && bot) {
    bot.chat(input);
  }
});

// Suppress unhandled exceptions like EPIPE
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') {
    console.log('Caught EPIPE error, ignoring (server closed connection).');
  } else {
    console.error('Uncaught Exception:', err);
  }
});
