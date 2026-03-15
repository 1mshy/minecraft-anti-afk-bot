const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

// Configuration
const CONFIG = {
  host: 'donutsmp.net',
  port: 25565,
  username: 'Lazy_Kid', // Change to your Minecraft email or username
  auth: 'microsoft', // Use 'offline' for cracked servers
  version: '1.21.1', // Changed from false. Note: 1.21.11 is a Bedrock version, Java uses 1.21.1 or 1.21.2 etc.
  interval: 15000, // Time in milliseconds between movements (e.g., 15 seconds)
  areaSize: 1 // 1 block radius = 3x3 area centered on the start position
};

const bot = mineflayer.createBot({
  host: CONFIG.host,
  port: CONFIG.port,
  username: CONFIG.username,
  auth: CONFIG.auth,
  version: CONFIG.version
});

bot.loadPlugin(pathfinder);

let startPosition = null;
let afkInterval = null;

bot.on('spawn', () => {
  console.log('Bot has spawned!');

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
  console.log('Bot disconnected.');
  if (afkInterval) clearInterval(afkInterval);
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
