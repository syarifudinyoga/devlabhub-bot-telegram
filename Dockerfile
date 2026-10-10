FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=3006

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=node:node src ./src

USER node
EXPOSE 3006

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3006/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
