FROM node:22-bookworm-slim

# The official Kerala State Lotteries result is published as a PDF.
# Poppler provides pdftotext for extracting the official winning numbers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 10000

CMD ["npm", "start"]
