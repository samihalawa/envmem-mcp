FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
ENTRYPOINT ["node", "bin/envmem.js"]