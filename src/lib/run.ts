import debug from 'debug';
import LRU from 'lru-cache';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { LogLevel } from 'telegram/extensions/Logger';
import { telegram_service_ids } from '../constants';
import { config } from '../config';

const logger = debug('app:telegram');

const cache = new LRU({ max: 1000 });

export const run = async () => {
  const { api_id, api_hash, antispam, proxy, session_string } = config;

  const stringSession = new StringSession(session_string);

  const client = new TelegramClient(stringSession, api_id, api_hash, {
    // @ts-ignore
    proxy,
    connectionRetries: 5,
  });

  client.setLogLevel(LogLevel.INFO);

  await client.connect();

  const me = (await client.getMe()) as unknown as Api.User;
  const meIdStr = me.id.toString();
  logger('run:me', meIdStr);

  async function showWelcome() {
    const welcome = `You should now be connected. - ${new Date().toLocaleDateString()}`;
    // logger('showWelcome:welcome', welcome);
    const message = await client.sendMessage('me', {
      message: welcome,
    });
    // logger('showWelcome:message', message);

    setTimeout(() => {
      message.delete({
        revoke: true,
      });
    }, 5 * 1000);
  }

  async function checkDialogs() {
    const dialogs = await client.getDialogs();

    dialogs.map(async (dialog) => {
      const { id, name, title, isUser, isChannel, isGroup, archived } = dialog;

      if (isUser) {
        const idStr = id?.toString();

        if (!archived) {
          cache.set(id?.toString(), true);
        } else {
          logger('checkDialogs:isUser:dialog', {
            name,
            title,
            archived,
            id,
            idStr,
          });
        }
        return;
      }

      if (isChannel) {
        // logger('checkDialogs:channel', title);
        return;
      }

      if (isGroup) {
        // logger('checkDialogs:group', title);
        return;
      }
    });
  }

  async function messageHandler(event: NewMessageEvent) {
    const { message } = event;
    const {
      out,
      isPrivate,
      isChannel,
      isGroup,
      chatId,
      id: messageId,
      message: messageContent,
    } = message;

    const chatIdStr = chatId?.toString();

    // skip
    if (
      !chatId ||
      !chatIdStr ||
      chatIdStr === meIdStr ||
      isGroup ||
      isChannel ||
      !isPrivate ||
      telegram_service_ids.includes(chatIdStr) ||
      cache.has(chatIdStr)
    ) {
      return;
    }

    if (out) {
      if (messageContent.includes(antispam.question)) {
        cache.set(chatIdStr, true);
      }
      return;
    }

    // handler
    logger('messageHandler:message', {
      isChannel,
      isGroup,
      isPrivate,
      chatId,
      chatIdStr,
      messageId,
      messageContent,
    });

    if (messageContent.includes(antispam.answer)) {
      logger('messageHandler:god answer');

      cache.set(chatIdStr, true);
      client.sendMessage(chatId, {
        message: 'You have passed the verification. Thanks.',
      });
    } else {
      logger('messageHandler:bad answer');

      await message.reply({
        message: antispam.question,
      });

      await message.delete({
        revoke: true,
      });
    }
  }

  await showWelcome();
  await checkDialogs();

  client.addEventHandler(messageHandler, new NewMessage({}));
};
