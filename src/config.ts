import dotenv from 'dotenv';

dotenv.config();

const api_id = process.env.API_ID;
const proxy_port = process.env.PROXY_PORT;
const proxy_socket_type = process.env.PROXY_SOCKET_TYPE;

export const config = {
  app_title: process.env.APP_TITLE || 'prjv20221218',

  api_id: (api_id && parseInt(api_id)) || 27197159,
  api_hash: process.env.API_HASH || '80aebf9b476b9f2f919d19908f9e317b',

  proxy: {
    ip: process.env.PROXY_IP || '192.168.1.105',
    port: (proxy_port && parseInt(proxy_port)) || 1080,
    socksType: (proxy_socket_type && parseInt(proxy_socket_type)) || 5,
  },

  antispam: {
    question: process.env.ANTISPAM_QUESTION || '1024-24=?',
    answer: process.env.ANTISPAM_ANSWER || '1000',
  },

  session_string: process.env.SESSION_STRING || '',
};
