FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

RUN npm run build:full

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
