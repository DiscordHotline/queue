FROM node:alpine

ARG SCRIPT=dev
ARG ENVIRONMENT=dev

ENV SCRIPT=$SCRIPT
ENV NODE_ENV=$ENIRONMENT

CMD /usr/bin/supervisord -n -c /app/supervisord.conf
WORKDIR /app

RUN apk add --update supervisor python py-pip \
    && pip install supervisor-stdout

COPY package.json package-lock.json /app/
RUN if [[ "$ENVIRONMENT" = "prod" ]]; then npm install; fi

COPY . /app/
RUN if [[ "$ENVIRONMENT" = "prod" ]]; then npm run build; fi
