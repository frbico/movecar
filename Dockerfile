FROM node:24-alpine
WORKDIR /app
COPY server.mjs /app/server.mjs
COPY upstream/movecar.js /app/upstream/movecar.js
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=8080 DB_PATH=/app/data/state.sqlite SOURCE_PATH=/app/upstream/movecar.js
EXPOSE 8080
CMD ["node", "server.mjs"]
