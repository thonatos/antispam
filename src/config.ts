import dotenv from 'dotenv';
import { Config } from './lib/antispam';

dotenv.config();

const getProxy = () => {
  const proxy_ip = process.env.PROXY_IP;
  const proxy_port = process.env.PROXY_PORT;
  const proxy_socket_type = process.env.PROXY_SOCKET_TYPE;

  if (!proxy_ip || !proxy_port || !proxy_socket_type) {
    return;
  }

  return {
    ip: proxy_ip,
    port: parseInt(proxy_port),
    socksType: parseInt(proxy_socket_type),
  };
};

const getApiId = () => {
  const api_id = process.env.API_ID;

  if (!api_id) {
    return;
  }

  return parseInt(api_id);
};

export const config: Config = {
  api_id: getApiId() || 27197159,
  app_title: process.env.APP_TITLE || 'prjv20221218',
  api_hash: process.env.API_HASH || '80aebf9b476b9f2f919d19908f9e317b',

  proxy: getProxy(),

  antispam: {
    question: process.env.ANTISPAM_QUESTION || '1024-24=?',
    answer: process.env.ANTISPAM_ANSWER || '1000',

    cron_time: process.env.ANTISPAM_CRON_TIME || '*/5 * * * *',
  },

  session_string: process.env.SESSION_STRING || '',

  data_file: process.env.DATA_FILE || 'data/data.json',
};
