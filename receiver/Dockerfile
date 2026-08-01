FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    NOW_PLAYING_DATA_DIR=/data

WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8787
VOLUME ["/data"]

CMD ["node", "server.mjs"]
