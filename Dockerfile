FROM node:alpine

ARG ENVIRONMENT=dev
ENV NODE_ENV=$ENIRONMENT

CMD /usr/bin/supervisord -n -c /app/supervisord.conf
WORKDIR /app

RUN apk add --update supervisor python py-pip \
    && pip install supervisor-stdout

COPY package.json package-lock.json /app/
RUN if [[ "$ENVIRONMENT" = "production" ]]; then npm install; fi

COPY . /app/
RUN if [[ "$ENVIRONMENT" = "production" ]]; then npm run build; fi
