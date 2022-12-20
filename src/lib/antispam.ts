import fs from 'fs-extra';
import path from 'path';
import Debug from 'debug';
import { CronJob } from 'cron';

// @ts-ignore
import input from 'input';
import { Api, TelegramClient, utils } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { LogLevel } from 'telegram/extensions/Logger';

import { telegram_service_ids } from '../constants';
import { config } from '../config';

const debug = Debug('app:antispam');

export default class Antispam {
  config: Config;
  whitelist: Set<string>;
  baseDir: string;
  dataFile: string;

  client: TelegramClient;

  meIdStr: string;

  constructor() {
    this.config = config;
    this.whitelist = new Set();
    this.baseDir = process.cwd();
    this.meIdStr = '';

    // init telegram client
    const { api_id, api_hash, proxy, session_string } = this.config;
    const stringSession = new StringSession(session_string);

    this.client = new TelegramClient(stringSession, api_id, api_hash, {
      // @ts-ignore
      proxy,
      connectionRetries: 5,
    });
    this.client.setLogLevel(LogLevel.INFO);

    // init data file
    this.dataFile = path.join(
      this.baseDir,
      this.config.data_file || 'data.json'
    );

    if (!fs.existsSync(this.dataFile)) {
      fs.ensureFileSync(this.dataFile);
      fs.writeFileSync(this.dataFile, '[]');
    }
  }

  async init() {
    const welcome = `You should now be connected - ${new Date().toLocaleDateString()}`;
    // debug('init:welcome', welcome);

    const me = (await this.client.getMe()) as unknown as Api.User;
    const meIdStr = me.id.toString();

    this.meIdStr = meIdStr;
    debug('init:meIdStr', meIdStr);

    const message = await this.client.sendMessage('me', {
      message: welcome,
    });
    // debug('init:message', message);

    setTimeout(() => {
      message.delete({
        revoke: true,
      });
    }, 5 * 1000);
  }

  async notify() {
    const notification = `Antispam is running - ${new Date().toLocaleDateString()}`;

    const message = await this.client.sendMessage('me', {
      message: notification,
    });

    setTimeout(() => {
      message.delete({
        revoke: true,
      });
    }, 5 * 1000);
  }

  async read() {
    const dataFile = this.dataFile;
    try {
      const cachedKeys = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
      debug('read:cachedKeys', cachedKeys.length);

      cachedKeys.map((key: string) => this.whitelist.add(key));
    } catch (error) {
      debug('read:error', error);
    }
  }

  async save() {
    const dataFile = this.dataFile;
    try {
      const cachedKeys = Array.from(this.whitelist);
      debug('save:cachedKeys', cachedKeys.length);

      fs.writeFileSync(dataFile, JSON.stringify(cachedKeys, null, 2));
    } catch (error) {
      debug('save:error', error);
    }
  }

  async clean() {
    const dialogs = await this.client.getDialogs();

    dialogs.map(async (dialog) => {
      const { id, name, title, isUser, isChannel, isGroup, archived } = dialog;

      if (isChannel) {
        // debug('checkDialogs:channel', title);
        return;
      }

      if (isGroup) {
        // debug('checkDialogs:group', title);
        return;
      }

      if (isUser) {
        const idStr = id?.toString();

        if (!idStr) {
          return;
        }

        // deleted account
        if (!name && !title) {
          debug('checkDialogs:isUser:dialog', 'deleted account', {
            name,
            title,
            archived,
            id,
            idStr,
          });

          this.whitelist.delete(idStr);
          await this.clearDialogs(idStr);
          return;
        }

        // normal dialog
        if (!archived) {
          this.whitelist.add(idStr);
          return;
        }

        // existing dialog
        if (this.whitelist.has(idStr)) {
          return;
        }

        // archived dialog
        debug('checkDialogs:isUser:dialog', {
          name,
          title,
          archived,
          id,
          idStr,
        });

        await this.clearDialogs(idStr);
      }
    });
  }

  async clearDialogs(id: string) {
    const userId = utils.parseID(id);

    if (!userId) {
      return;
    }

    const result = await this.client.invoke(
      new Api.messages.DeleteHistory({
        justClear: true,
        revoke: true,
        peer: new Api.PeerUser({
          userId,
        }),
      })
    );
    debug('clearDialogs:result', result.ptsCount);
  }

  async messageHandler(event: NewMessageEvent) {
    const { meIdStr } = this;
    const { antispam } = this.config;
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
      this.whitelist.has(chatIdStr)
    ) {
      return;
    }

    if (out) {
      if (messageContent.includes(antispam.question)) {
        this.whitelist.add(chatIdStr);
      }
      return;
    }

    // handler
    debug('messageHandler:message', {
      isChannel,
      isGroup,
      isPrivate,
      chatId,
      chatIdStr,
      messageId,
      messageContent,
    });

    if (messageContent.includes(antispam.answer)) {
      debug('messageHandler:god answer');
      this.whitelist.add(chatIdStr);
      this.client.sendMessage(chatId, {
        message: 'You have passed the verification. Thanks.',
      });

      this.save();
    } else {
      debug('messageHandler:bad answer');
      await message.reply({
        message: antispam.question,
      });

      // await message.markAsRead();
      await message.delete({
        revoke: true,
      });
    }
  }

  async login() {
    await this.client.start({
      phoneNumber: async () => await input.text('Please enter your number: '),
      password: async () => await input.text('Please enter your password: '),
      phoneCode: async () =>
        await input.text('Please enter the code you received: '),
      onError: (err) => console.log(err),
    });

    debug('login', 'You should now be connected.');

    const sessionString = this.client.session.save();
    debug('login:sessionString', sessionString);
  }

  async run() {
    await this.client.connect();

    await this.read();
    await this.init();

    // events
    this.client.addEventHandler(
      this.messageHandler.bind(this),
      new NewMessage()
    );

    // schedule
    const schedule = new CronJob(
      '*/5 * * * *',
      async () => {
        debug('schedule: running a task every 5 minute');
        await this.notify();
        await this.clean();
        await this.save();
      },
      null,
      true,
      'Asia/Shanghai'
    );

    schedule.start();
  }
}

export interface Config {
  app_title: string;
  api_id: number;
  api_hash: string;

  proxy?: {
    ip: string;
    port: number;
    socksType: number;
  };

  antispam: {
    question: string;
    answer: string;
  };

  session_string: string;

  data_file?: string;
}
