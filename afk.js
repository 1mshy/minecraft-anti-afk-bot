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

// Live map of scoreboard entries: itemName -> value
// Populated from raw scoreboard_score packets (1.20.4 format)
const scoreboardEntries = new Map();

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

  // Shared helper — safe to call multiple times; the interval guard ensures it only starts once
  function startShardsTracking(delayMs, reason) {
    if (shardsCheckInterval) return; // already running
    console.log(`[Shards] ${reason} — starting shards check in ${delayMs / 1000}s...`);
    setTimeout(() => {
      if (shardsCheckInterval) return; // another path beat us to it
      lastShardsValue = getShardsValue();
      console.log(`[Shards] Initial shards value: ${lastShardsValue ?? 'not found'}`);
      console.log('[Shards] Shards AFK-world check running every 60s.');

      shardsCheckInterval = setInterval(async () => {
        const currentShards = getShardsValue();
        console.log(`[Shards] Shards now: ${currentShards ?? 'not found'}, was: ${lastShardsValue ?? 'not found'}`);

        if (currentShards !== null && lastShardsValue !== null) {
          const diff = currentShards - lastShardsValue;
          if (diff >= 1) {
            console.log(`[Shards] ✅ In AFK world! Shards +${diff} over last minute.`);
          } else {
            console.log(`[Shards] ❌ NOT in AFK world! Shards diff: ${diff}. Re-sending /afk...`);
            await sendDiscordWebhook(`⚠️ **AFK Bot Alert:** Not in AFK world! Shards did not increase. Re-sending /afk.`);
            bot.chat('/afk');
          }
        } else {
          console.log('[Shards] ⚠️ Could not read shards from scoreboard.');
        }

        lastShardsValue = currentShards;
      }, 60000);
    }, delayMs);
  }

  bot.on('spawn', () => {
    if (!spawnedOnce) {
      console.log('Bot has spawned!');
      spawnedOnce = true;
    }
    // Fallback: if the bot spawns already inside the AFK world (no windowOpen fires),
    // start tracking after 30s so the scoreboard has time to populate.
    startShardsTracking(30000, 'Spawned (fallback path)');
  });

  bot.on('windowOpen', (window) => {
    const slotToClick = 49;
    console.log(`Window opened: ${window.title ? window.title : 'Unknown'} (${window.type})`);

    setTimeout(() => {
      console.log(`Clicking slot ${slotToClick}...`);
      bot.clickWindow(slotToClick, 0, 0).then(() => {
        console.log('Successfully clicked the AFK slot.');
        // Start tracking 15s after clicking — the window path gets priority over the spawn fallback
        startShardsTracking(15000, 'Clicked AFK slot');
      }).catch(err => {
        console.log('Error clicking window:', err);
      });
    }, 1500);
  });

  // Listen to raw scoreboard_score packets (1.20.4 uses this instead of update_score)
  // itemName = display text of the row (e.g. "§6 Shards §e32")
  // value    = sort order (8, 7, 6 ...), NOT the actual stat number
  bot._client.on('scoreboard_score', (packet) => {
    scoreboardEntries.set(packet.itemName, packet);
    // Debug: show hex bytes of itemName + all packet fields
    const hex = Buffer.from(packet.itemName ?? '', 'utf8').toString('hex');
    console.log(`[ScoreHex] value=${packet.value} itemName_hex=${hex} keys=${Object.keys(packet).join(',')}`);
    if (packet.displayName !== undefined) console.log(`  displayName:`, JSON.stringify(packet.displayName));
    if (packet.numberFormat !== undefined) console.log(`  numberFormat:`, JSON.stringify(packet.numberFormat));
  });
  bot._client.on('reset_score', (packet) => {
    scoreboardEntries.delete(packet.entity_name);
  });
  // Clear all entries when the objective is removed (action 1)
  bot._client.on('scoreboard_objective', (packet) => {
    if (packet.action === 1) scoreboardEntries.clear();
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
 * Reads the "Shards" value from the live scoreboard entries map.
 *
 * DonutSMP sidebar (1.20.4) sends scoreboard_score packets where:
 *   - itemName = full formatted display text, e.g. "§6 Shards §e32"
 *   - value    = row sort order (not the stat)
 *
 * We strip formatting codes and find the entry whose text contains
 * "shards", then parse the trailing number.
 */
function getShardsValue() {
  try {
    for (const [itemName] of scoreboardEntries) {
      // Strip all §X formatting codes and trim whitespace
      const clean = itemName.replace(/§[\s\S]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (clean.includes('shards')) {
        // Extract the last number in the text, e.g. "shards 32" -> 32
        const match = clean.match(/(\d[\d,.]*)\s*$/);
        if (match) {
          const num = parseFloat(match[1].replace(/,/g, ''));
          if (!isNaN(num)) return num;
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
rl.on('line', async (input) => {
  const trimmed = input.trim();
  if (!trimmed || !bot) return;

  const walkMatch = trimmed.match(/^\/walk\s+(\d+)$/i);
  if (walkMatch) {
    const blocks = parseInt(walkMatch[1], 10);
    // Approx 1 block ~= 270ms at normal walk speed; adjust if needed
    const durationMs = blocks * 270;
    console.log(`[Walk] Walking forward ${blocks} block(s) (~${durationMs}ms)`);
    bot.setControlState('forward', true);
    bot.setControlState('sneak', false);
    setTimeout(() => {
      bot.setControlState('forward', false);
      console.log(`[Walk] Done walking ${blocks} block(s).`);
    }, durationMs);
  } else {
    bot.chat(trimmed);
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
