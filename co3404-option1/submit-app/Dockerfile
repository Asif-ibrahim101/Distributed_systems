FROM node:18-alpine

WORKDIR /app

# Install dependencies first for better Docker layer caching
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

EXPOSE 3200

CMD ["node", "server.js"]
