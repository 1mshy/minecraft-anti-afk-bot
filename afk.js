const mineflayer = require('mineflayer');

// Configuration
const CONFIG = {
  host: 'donutsmp.net',
  port: 25565,
  username: 'tubetop', // Change to your Minecraft email or username
  auth: 'microsoft', // Use 'offline' for cracked servers
  version: '1.20.4', // Changed to extremely stable 1.20.4 instead of 1.21.11 (Bedrock version) or false
  webhookUrl: 'https://discord.com/api/webhooks/1482531525118656543/C4r99Gq-X_GjI8IRbIaUjzUDRh1Qrow06kpmH9qJfyYNUsHd4p6HZ_jIt19haxZZxO2_' // Add your Discord webhook URL here
};

const bot = mineflayer.createBot({
  host: CONFIG.host,
  port: CONFIG.port,
  username: CONFIG.username,
  auth: CONFIG.auth,
  version: CONFIG.version
});

let isEating = false;
let previousHealth = 20;

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

let spawnedOnce = false;

bot.on('spawn', () => {
  if (!spawnedOnce) {
    console.log('Bot has spawned!');
    spawnedOnce = true;

    // Wait a brief moment before typing /afk to make sure we're fully logged in and the server is ready
    setTimeout(() => {
      console.log('Typing /afk...');
      bot.chat('/afk');
    }, 3000);
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
  console.log('Bot disconnected.');
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
