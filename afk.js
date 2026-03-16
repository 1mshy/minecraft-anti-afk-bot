import 'dotenv/config';
import mineflayer from 'mineflayer';
import readline from 'readline';

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
  let bot;
  let isEating = false;
  let previousHealth = 20;
  let spawnedOnce = false;

  // Shards AFK-world tracking
  let lastShardsValue = null;
  let shardsCheckInterval = null;
  let autoReconnectTimeout = null;

  if (autoReconnectTimeout) {
    clearTimeout(autoReconnectTimeout);
    autoReconnectTimeout = null;
  }
  
  // Disconnect every 6 hours to avoid sticking points
  autoReconnectTimeout = setTimeout(() => {
    console.log(`[${username}] 6 hours have passed. Disconnecting to reconnect...`);
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
      console.log(`[${username}] Failed to send webhook:`, err);
    }
  }

  // Shared helper — safe to call multiple times; the interval guard ensures it only starts once
  function startShardsTracking(delayMs, reason) {
    if (shardsCheckInterval) return; // already running
    console.log(`[${username}] [Shards] ${reason} — starting shards check in ${delayMs / 1000}s...`);
    setTimeout(() => {
      if (shardsCheckInterval) return; // another path beat us to it
      console.log(`[${username}] [Shards] Shards AFK-world check running every 60s. Sending initial /shards query.`);
      
      bot.chat('/shards');

      shardsCheckInterval = setInterval(() => {
        bot.chat('/shards');
      }, 60000);
    }, delayMs);
  }

  bot.on('spawn', () => {
    if (!spawnedOnce) {
      console.log(`[${username}] Bot has spawned!`);
      spawnedOnce = true;
    }
    // Fallback: if the bot spawns already inside the AFK world (no windowOpen fires),
    // start tracking after 30s so the scoreboard has time to populate.
    startShardsTracking(30000, 'Spawned (fallback path)');
  });

  bot.on('windowOpen', (window) => {
    const slotToClick = 49;
    console.log(`[${username}] Window opened: ${window.title ? window.title : 'Unknown'} (${window.type})`);

    setTimeout(() => {
      console.log(`[${username}] Clicking slot ${slotToClick}...`);
      bot.clickWindow(slotToClick, 0, 0).then(() => {
        console.log(`[${username}] Successfully clicked the AFK slot.`);
        // Start tracking 15s after clicking — the window path gets priority over the spawn fallback
        startShardsTracking(15000, 'Clicked AFK slot');
      }).catch(err => {
        console.log(`[${username}] Error clicking window:`, err);
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

      console.log(`[${username}] [Shards] Shards now: ${currentShards}, was: ${lastShardsValue ?? 'not found'}`);
      
      if (lastShardsValue !== null) {
        const diff = currentShards - lastShardsValue;
        if (diff >= 1) {
          console.log(`[${username}] [Shards] ✅ In AFK world! Shards +${diff} over last minute.`);
          
          // Check if we crossed a multiple of 1500
          if (Math.floor(lastShardsValue / 1500) < Math.floor(currentShards / 1500)) {
            const milestone = Math.floor(currentShards / 1500) * 1500;
            console.log(`[${username}] [Shards] 🎯 Milestone reached: ${milestone} shards!`);
            await sendDiscordWebhook(`🎉 **Milestone Reached!** We just hit **${milestone} shards**! (Current: ${currentShards})`);
          }
          
        } else {
          console.log(`[${username}] [Shards] ❌ NOT in AFK world! Shards diff: ${diff}. Re-sending /afk...`);
          await sendDiscordWebhook(`⚠️ **AFK Bot Alert:** Not in AFK world! Shards did not increase. Re-sending /afk.`);
          bot.chat('/afk');
        }
      } else {
        console.log(`[${username}] [Shards] Initial shards value set to: ${currentShards}`);
      }
      lastShardsValue = currentShards;
    }
  });


  bot.on('error', (err) => {
    console.log(`[${username}] Error: ${err}`);
  });

  bot.on('kicked', (reason) => {
    console.log(`[${username}] Kicked from server:`, reason);
  });

  bot.on('end', () => {
    console.log(`[${username}] Bot disconnected. Reconnecting in 10 seconds...`);
    spawnedOnce = false;
    if (autoReconnectTimeout) {
      clearTimeout(autoReconnectTimeout);
      autoReconnectTimeout = null;
    }
    if (shardsCheckInterval) {
      clearInterval(shardsCheckInterval);
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
      console.log(`[${username}] Bot injured! Health: ${bot.health.toFixed(1)}/20`);
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
          console.log(`[${username}] Ate a cooked beef.`);
        } catch (err) {
          console.log(`[${username}] Error eating:`, err);
        } finally {
          isEating = false;
        }
      }
    }
  });

  bot.on('death', async () => {
    console.log(`[${username}] Bot died!`);
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
      const delayMs = Math.floor(Math.random() * 30000);
      console.log(`Waiting ${Math.round(delayMs / 1000)} seconds before logging in the next bot...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

startAllBots();

function walkBots(blocks) {
  // Approx 1 block ~= 270ms at normal walk speed; adjust if needed
  const durationMs = blocks * 270;
  console.log(`[Walk] Walking forward ${blocks} block(s) (~${durationMs}ms) for all bots`);
  bots.forEach(b => {
    b.setControlState('forward', true);
    b.setControlState('sneak', false);
  });
  setTimeout(() => {
    bots.forEach(b => {
      b.setControlState('forward', false);
    });
    console.log(`[Walk] Done walking ${blocks} block(s).`);
  }, durationMs);
}

// Setup terminal command input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
console.log("setup command passing")
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
    console.log('Caught EPIPE error, ignoring (server closed connection).');
  } else {
    console.error('Uncaught Exception:', err);
  }
});
