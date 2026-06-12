# MONOLYTHIUM — THE ANCHORFALL game server (public deployment)
# Build context = holdout-hd/ (set the service root directory accordingly).
FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# PUBLIC_DEPLOY hardens the server for the open internet (no LAN URL in
# lobbies, smoke hooks dead, proxy-aware client IPs). SAVES_DIR should be a
# mounted volume so rankings survive redeploys. The platform injects PORT.
ENV NODE_ENV=production \
    PUBLIC_DEPLOY=1 \
    SAVES_DIR=/data

EXPOSE 3001
CMD ["node", "server.js"]
