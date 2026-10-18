FROM node:24-alpine
WORKDIR /app
COPY release.json update-service.mjs server.mjs infrastructure.mjs request-flow.mjs voice-service.mjs mobile-owner.mjs voice-entry.js voice-page.js voice-page.html admin.html admin.css admin.js request-ui.js owner-view.html owner-view.js photo-ui.js /app/
COPY upstream/movecar.js /app/upstream/movecar.js
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=8888 DB_PATH=/app/data/state.sqlite SOURCE_PATH=/app/upstream/movecar.js
EXPOSE 8888
CMD ["node", "server.mjs"]
