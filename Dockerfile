FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /var/data/audio /var/data/covers /var/data/tmp \
 && chown -R node:node /app /var/data
ENV DATA_DIR=/var/data
USER node
EXPOSE 3000
CMD ["npm", "start"]
