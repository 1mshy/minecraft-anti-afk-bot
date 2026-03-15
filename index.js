const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

// Configuration
const CONFIG = {
  host: 'donutsmp.net',
  port: 25565,
  username: 'Lazy_Kid', // Change to your Minecraft email or username
  auth: 'microsoft', // Use 'offline' for cracked servers
  version: '1.20.4', // Changed to extremely stable 1.20.4 instead of 1.21.11 (Bedrock version) or false
  interval: 15000, // Time in milliseconds between movements (e.g., 15 seconds)
  areaSize: 2, // 1 block radius = 3x3 area centered on the start position
  webhookUrl: 'https://discord.com/api/webhooks/1482531525118656543/C4r99Gq-X_GjI8IRbIaUjzUDRh1Qrow06kpmH9qJfyYNUsHd4p6HZ_jIt19haxZZxO2_' // Add your Discord webhook URL here
};

let bot;
let startPosition = null;
let afkInterval = null;
let previousHealth = 20;

function createBot() {
  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    auth: CONFIG.auth,
    version: CONFIG.version
  });

  bot.loadPlugin(pathfinder);


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
  console.log('Bot has spawned!');
  bot.setControlState('sneak', true); // Shift always

  // Record the starting position when the bot spawns to keep it anchored
  if (!startPosition) {
    // Wait a brief moment for gravity to settle before recording Y
    setTimeout(() => {
      startPosition = bot.entity.position.clone();
      console.log(`Recorded start position at ${startPosition.x.toFixed(2)}, ${startPosition.y.toFixed(2)}, ${startPosition.z.toFixed(2)}`);

      // Setup pathfinder movements
      const defaultMove = new Movements(bot, bot.registry);
      defaultMove.canDig = false; // Don't break blocks
      defaultMove.allow1by1towers = false; // Don't try to build towers
      defaultMove.scafoldingBlocks = []; // Don't place blocks
      bot.pathfinder.setMovements(defaultMove);

      // Start the anti-AFK loop
      if (!afkInterval) {
        console.log(`Starting Anti-AFK loop every ${CONFIG.interval}ms in a 3x3 area.`);
        afkInterval = setInterval(performAntiAFK, CONFIG.interval);
      }
    }, 2000);
  }
});

bot.on('error', (err) => {
  console.log(`Error: ${err}`);
});

bot.on('kicked', (reason) => {
    console.log(`Kicked from server:`, reason);
    if (afkInterval) clearInterval(afkInterval);
  });

  bot.on('end', () => {
    console.log('Bot disconnected. Reconnecting in 10 seconds...');
    if (afkInterval) {
      clearInterval(afkInterval);
      afkInterval = null;
    }
    startPosition = null;
    setTimeout(createBot, 10000);
  });

bot.on('physicsTick', () => {
  bot.setControlState('sneak', true);
});

let isEating = false;

  bot.on('health', async () => {
  if (bot.health < previousHealth) {
    console.log(`Bot injured! Health: ${bot.health.toFixed(1)}/20`);
    await sendDiscordWebhook(`⚠️ **Bot Alert:** Injured! Current health: ${bot.health.toFixed(1)}/20`);
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
        bot.setControlState('sneak', true); // Ensure we keep sneaking
      }
    }
  }
});

bot.on('death', async () => {
  console.log('Bot died!');
  await sendDiscordWebhook(`💀 **Bot Alert:** Died!`);
});

function performAntiAFK() {
  if (!startPosition || !bot.entity) return;

  // Calculate a random offset within the areaSize
  // areaSize of 1 gives an offset of -1, 0, or 1 on both X and Z axes (3x3 grid)
  const offsetX = Math.floor(Math.random() * (CONFIG.areaSize * 2 + 1)) - CONFIG.areaSize;
  const offsetZ = Math.floor(Math.random() * (CONFIG.areaSize * 2 + 1)) - CONFIG.areaSize;

  const targetX = startPosition.x + offsetX;
  const targetZ = startPosition.z + offsetZ;

  // We use GoalNear to get within 1 block of the exact coordinate. 
  // You can also use GoalBlock if you want it to stand exactly on the specific block center.
  const goal = new goals.GoalNear(targetX, startPosition.y, targetZ, 1);

  console.log(`Anti-AFK: Moving towards X:${targetX.toFixed(1)} Z:${targetZ.toFixed(1)} (Offset: ${offsetX}, ${offsetZ})`);

  bot.setControlState('sneak', true); // Shift always
  // Only set goal if we are not currently pathfinding to avoid overlapping commands
  if (!bot.pathfinder.isMoving()) {
    bot.pathfinder.setGoal(goal);
  }
}

  // Basic utility to allow you to reset the center by sending a whisper to the bot
  bot.on('whisper', (username, message) => {
    if (message === 'resetcenter') {
      startPosition = bot.entity.position.clone();
      console.log(`Center reset by ${username} to ${startPosition.x.toFixed(2)}, ${startPosition.y.toFixed(2)}, ${startPosition.z.toFixed(2)}`);
      bot.whisper(username, 'AFK center updated to my current position.');
    }
  });
}

createBot();

// Setup terminal command input
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

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
