import fs from 'fs';
import debug from 'debug';
import { Api, TelegramClient, utils } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { LogLevel } from 'telegram/extensions/Logger';
import { telegram_service_ids } from '../constants';
import { config } from '../config';

const logger = debug('app:telegram');
const whitelist = new Set();

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

  async function readWhiteList() {
    try {
      const cachedKeys = JSON.parse(
        fs.readFileSync('whitelist.json').toString()
      );
      logger('readWhiteList:cachedKeys', cachedKeys.length);
      cachedKeys.map((key: string) => whitelist.add(key));
    } catch (error) {
      logger('readWhiteList:error', error);
    }
  }

  async function saveWhitelist() {
    try {
      const cachedKeys = Array.from(whitelist);
      logger('saveWhitelist:cachedKeys', cachedKeys.length);
      fs.writeFileSync('whitelist.json', JSON.stringify(cachedKeys, null, 2));
    } catch (error) {
      logger('saveWhitelist:error', error);
    }
  }

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

  async function clearDialogs(id: string) {
    const userId = utils.parseID(id);

    if (!userId) {
      return;
    }

    const result = await client.invoke(
      new Api.messages.DeleteHistory({
        justClear: true,
        revoke: true,
        peer: new Api.PeerUser({
          userId,
        }),
      })
    );
    logger('clearDialogs:result', result);
  }

  async function checkDialogs() {
    const dialogs = await client.getDialogs();

    dialogs.map(async (dialog) => {
      const { id, name, title, isUser, isChannel, isGroup, archived } = dialog;

      if (isChannel) {
        // logger('checkDialogs:channel', title);
        return;
      }

      if (isGroup) {
        // logger('checkDialogs:group', title);
        return;
      }

      if (isUser) {
        const idStr = id?.toString();

        if (!idStr) {
          return;
        }

        if (!archived) {
          whitelist.add(idStr);
          return;
        }

        if (whitelist.has(idStr)) {
          return;
        }

        logger('checkDialogs:isUser:dialog', {
          name,
          title,
          archived,
          id,
          idStr,
        });

        await clearDialogs(idStr);
      }

      saveWhitelist();
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
      whitelist.has(chatIdStr)
    ) {
      return;
    }

    if (out) {
      if (messageContent.includes(antispam.question)) {
        whitelist.add(chatIdStr);
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
      whitelist.add(chatIdStr);
      client.sendMessage(chatId, {
        message: 'You have passed the verification. Thanks.',
      });

      saveWhitelist();
    } else {
      logger('messageHandler:bad answer');
      await message.reply({
        message: antispam.question,
      });

      // await message.markAsRead();
      await message.delete({
        revoke: true,
      });
    }
  }

  await readWhiteList();
  await showWelcome();
  await checkDialogs();

  client.addEventHandler(messageHandler, new NewMessage({}));
};
