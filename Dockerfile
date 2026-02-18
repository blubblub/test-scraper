FROM apify/actor-node-playwright-chrome:20

COPY package*.json ./
RUN npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages." \
    && npm cache clean --force

COPY . ./
RUN npx tsc

CMD ["node", "dist/main.js"]
