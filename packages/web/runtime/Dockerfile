FROM mcr.microsoft.com/playwright:v1.64.0-noble
WORKDIR /opt/opengame
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY check.mjs guardian.mjs ./
ENV NODE_ENV=production HOME=/tmp OPENGAME_WEB_ROOT=/opt/opengame
USER 1000:1000
CMD ["node", "/opt/opengame/guardian.mjs"]
