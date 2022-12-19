import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

// @ts-ignore
import input from 'input';
import { config } from '../config';

export const login = async () => {
  const { api_id, api_hash, proxy } = config;

  const stringSession = new StringSession('');

  const client = new TelegramClient(stringSession, api_id, api_hash, {
    connectionRetries: 5,
    // @ts-ignore
    proxy,
  });

  await client.start({
    phoneNumber: async () => await input.text('Please enter your number: '),
    password: async () => await input.text('Please enter your password: '),
    phoneCode: async () =>
      await input.text('Please enter the code you received: '),
    onError: (err) => console.log(err),
  });

  console.log('You should now be connected.');

  console.log(client.session.save());
};
