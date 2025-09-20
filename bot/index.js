require('dotenv').config();
const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-render-domain.onrender.com';
if (!BOT_TOKEN) { console.error('BOT_TOKEN missing'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

// Глобальная кнопка в меню бота (в правом верхнем углу “Меню”)
bot.telegram.setChatMenuButton({
  menu_button: {
    type: 'web_app',
    text: '🎮 Open Game',
    web_app: { url: WEBAPP_URL }
  }
}).catch(console.error);

bot.start(async (ctx) => {
  // inline-кнопка открывает WebApp ВНУТРИ Telegram
  await ctx.reply('AlienX Arena: tap to play!', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 Open Game', web_app: { url: WEBAPP_URL } }]
      ]
    }
  });
});

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
