import fs from 'fs-extra';
import path from 'path';
import dayjs from 'dayjs';
import Debug from 'debug';
import { CronJob } from 'cron';

// @ts-ignore
import input from 'input';
import { Api, TelegramClient, utils } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { LogLevel } from 'telegram/extensions/Logger';

import { DEFAULT_DATA, TELEGRAM_SERVICE_IDS } from '../constants';
import { config } from '../config';

const debug = Debug('app:antispam');

export default class Antispam {
  config: Config;
  baseDir: string;
  dataFile: string;
  whitelist: Set<string>;
  serviceList: Set<string>;

  meIdStr: string;
  client: TelegramClient;

  constructor() {
    this.config = config;
    this.baseDir = process.cwd();
    this.whitelist = new Set();
    this.serviceList = new Set(TELEGRAM_SERVICE_IDS);

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

    // init data
    this.dataFile = path.join(
      this.baseDir,
      this.config.data_file || 'data.json'
    );
    this._initData();
  }

  private _initData() {
    if (fs.existsSync(this.dataFile)) {
      return;
    }

    fs.ensureFileSync(this.dataFile);
    fs.writeFileSync(this.dataFile, JSON.stringify(DEFAULT_DATA, null, 2));
  }

  async notify(msg: string, clear?: boolean) {
    const message = await this.client.sendMessage('me', {
      message: msg,
      silent: true,
    });

    if (!clear) {
      return;
    }

    setTimeout(() => {
      message.delete({
        revoke: true,
      });
    }, 5 * 1000);
  }

  async load() {
    const dataFile = this.dataFile;
    try {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

      const whiteList = data.whiteList || [];
      debug('load:whitelist', whiteList.length);

      this.whitelist.clear();
      whiteList.map((key: string) => this.whitelist.add(key));

      const serviceList = data.serviceList || [];
      debug('load:serviceList', serviceList.length);

      serviceList.map((key: string) => this.serviceList.add(key));
    } catch (error) {
      debug('load:error', error);
    }
  }

  async save() {
    const dataFile = this.dataFile;
    try {
      const cachedKeys = Array.from(this.whitelist);
      debug('save:cachedKeys', cachedKeys.length);

      fs.writeFileSync(
        dataFile,
        JSON.stringify(
          {
            whitelist: cachedKeys,
          },
          null,
          2
        )
      );
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

    const { ptsCount } = result;
    debug('clearDialogs:result', ptsCount);

    await this.notify(
      `AntiSpam: clear dialog from ${id} with ${ptsCount} messages`
    );
  }

  messageHandler = async (event: NewMessageEvent) => {
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
      this.serviceList.has(chatIdStr) ||
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

      await message.markAsRead();

      await message.reply({
        message: antispam.question,
      });

      // await message.delete({
      //   revoke: true,
      // });
    }
  };

  async init() {
    const me = (await this.client.getMe()) as unknown as Api.User;

    const meIdStr = me.id.toString();
    debug('init:meIdStr', meIdStr);

    this.meIdStr = meIdStr;

    const currentDateTime = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const welcome = `AntiSpam is running - ${currentDateTime}`;
    // debug('init:welcome', welcome);

    await this.notify(welcome);
  }

  async schedule() {
    const cronTime = this.config.antispam.cron_time;
    debug('schedule:cronTime', cronTime);

    const schedule = new CronJob(
      cronTime,
      async () => {
        const currentDateTime = dayjs().format('YYYY-MM-DD HH:mm:ss');
        const msg = `AntiSpam: clean spam - ${currentDateTime}`;
        debug('schedule:msg', msg);

        await this.clean();
        await this.save();
      },
      null,
      true,
      'Asia/Shanghai'
    );

    schedule.start();
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

    await this.load();
    await this.init();

    // events
    this.client.addEventHandler(this.messageHandler, new NewMessage());

    // schedule
    this.schedule();
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
    cron_time: string;
  };

  session_string: string;
  data_file?: string;
}
