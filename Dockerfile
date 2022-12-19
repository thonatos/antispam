FROM node:lts-alpine AS app

ENV TIME_ZONE=Asia/Shanghai

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN \
  # sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
  apk add --no-cache tzdata \
  && echo "${TIME_ZONE}" > /etc/timezone \ 
  && ln -sf /usr/share/zoneinfo/${TIME_ZONE} /etc/localtime \
  && yarn config set "strict-ssl" false \
  && npm config set strict-ssl false \
  && yarn install \
  && yarn build \
  && rm -rf node_modules \
  && yarn install --production \
  && yarn cache clean

# EXPOSE 7001

CMD npm run start
