require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-render-domain.onrender.com';

if (!BOT_TOKEN) { console.error('BOT_TOKEN missing'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  const kb = Markup.keyboard([Markup.button.webApp('🎮 Open Game', WEBAPP_URL)]).resize();
  return ctx.reply('AlienX Arena: tap to play!', kb);
});

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
