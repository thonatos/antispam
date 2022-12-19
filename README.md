# antispam

> antispam for telegram.

## Usage

### Auth

login in with your account by run command:

```bash
$ yarn cmd:login
```

then save the sesstion string to `.env` file.

### Config

you can customize QA with `.env` file.

```ini
ANTISPAM_ANSWER = 1000
ANTISPAM_QUESTION = "This account is protected by Antispam.\nPlease answer the question to continue:\n\n 1024-24=?"

SESSION_STRING = ""

# API_ID = 27197159
# API_HASH = 80aebf9b476b9f2f919d19908f9e317b
# APP_TITLE = prjv20221218

# PROXY_IP = 192.168.1.105
# PROXY_PORT = 1080
# PROXY_SOCKET_TYPE = 5
```

### Run Antispam

```bash
$ DEBUG=* yarn start // DEBUG=* yarn cmd:run
```
